import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

import { BlueshiftAnchorEscrow } from "../target/types/blueshift_anchor_escrow";

describe("blueshift_anchor_escrow", () => {
  // 使用 Anchor 默认 provider（本地 localnet + 本地钱包）
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .blueshiftAnchorEscrow as Program<BlueshiftAnchorEscrow>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // 与 Rust 侧 seed.to_le_bytes() 保持一致
  const seedToBuffer = (seed: number) => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(seed));
    return buf;
  };

  const findEscrowPda = (seed: number, maker: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.toBuffer(), seedToBuffer(seed)],
      program.programId
    );
  };

  const airdrop = async (to: PublicKey, sol = 2) => {
    const sig = await connection.requestAirdrop(
      to,
      sol * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
  };

  it("make -> take transfers assets and closes accounts", async () => {
    // maker 使用测试钱包；taker 使用新建账户模拟交易对手
    const maker = payer;
    const taker = Keypair.generate();
    await airdrop(taker.publicKey, 2);

    // 准备两种 mint：A（maker 出）、B（taker 出）
    const mintAuthority = payer;
    const decimals = 6;
    const mintA = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const mintB = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const makerAtaA = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintA,
      maker.publicKey
    );
    const takerAtaB = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintB,
      taker.publicKey
    );

    const amountA = 500_000;
    const receiveB = 250_000;

    // 预先给 maker 的 A ATA 和 taker 的 B ATA 打币
    await mintTo(
      connection,
      payer,
      mintA,
      makerAtaA.address,
      mintAuthority,
      amountA
    );
    await mintTo(
      connection,
      payer,
      mintB,
      takerAtaB.address,
      mintAuthority,
      receiveB
    );

    const seed = 42;
    // 预计算 PDA 与相关 ATA，便于显式传入 accounts，避免自动解析歧义
    const [escrowPda] = findEscrowPda(seed, maker.publicKey);
    const vault = getAssociatedTokenAddressSync(
      mintA,
      escrowPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const takeAtaA = getAssociatedTokenAddressSync(
      mintA,
      taker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const makerAtaB = getAssociatedTokenAddressSync(
      mintB,
      maker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await program.methods
      .make(new anchor.BN(seed), new anchor.BN(receiveB), new anchor.BN(amountA))
      .accounts({
        maker: maker.publicKey,
        escrow: escrowPda,
        mintA,
        mintB,
        makerAtaA: makerAtaA.address,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([])
      .rpc();

    // taker 支付 B，换取 escrow 中锁定的 A
    await program.methods
      .take()
      .accounts({
        taker: taker.publicKey,
        maker: maker.publicKey,
        escrow: escrowPda,
        mintA,
        mintB,
        vault,
        takeAtaA,
        takeAtaB: takerAtaB.address,
        makerAtaB,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    // 断言资产交换结果正确
    const makerB = await getAccount(connection, makerAtaB);
    const takerA = await getAccount(connection, takeAtaA);

    expect(Number(makerB.amount)).to.equal(receiveB);
    expect(Number(takerA.amount)).to.equal(amountA);

    // take 完成后 escrow 和 vault 都应被关闭
    const escrowInfo = await connection.getAccountInfo(escrowPda);
    const vaultInfo = await connection.getAccountInfo(vault);
    expect(escrowInfo).to.equal(null);
    expect(vaultInfo).to.equal(null);
  });

  it("make -> refund returns funds and closes accounts", async () => {
    const maker = payer;

    // refund 用例里 mint_b 只用于满足 make 的账户约束
    const mintAuthority = payer;
    const decimals = 6;
    const mintA = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const mintB = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const makerAtaA = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintA,
      maker.publicKey
    );

    const amountA = 400_000;
    const receiveB = 200_000;

    await mintTo(
      connection,
      payer,
      mintA,
      makerAtaA.address,
      mintAuthority,
      amountA
    );

    const seed = 77;
    const [escrowPda] = findEscrowPda(seed, maker.publicKey);
    const vault = getAssociatedTokenAddressSync(
      mintA,
      escrowPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // 记录 maker 初始 A 余额，用于验证退款后余额恢复
    const before = await getAccount(connection, makerAtaA.address);

    await program.methods
      .make(new anchor.BN(seed), new anchor.BN(receiveB), new anchor.BN(amountA))
      .accounts({
        maker: maker.publicKey,
        escrow: escrowPda,
        mintA,
        mintB,
        makerAtaA: makerAtaA.address,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([])
      .rpc();

    // maker 主动取消订单，取回 vault 中全部 A
    await program.methods
      .refund()
      .accounts({
        maker: maker.publicKey,
        escrow: escrowPda,
        mintA,
        vault,
        makerAtaA: makerAtaA.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([])
      .rpc();

    // 退款后 maker 的 A 余额应恢复到 make 前
    const after = await getAccount(connection, makerAtaA.address);
    expect(Number(after.amount)).to.equal(Number(before.amount));

    // refund 完成后 escrow 和 vault 都应被关闭
    const escrowInfo = await connection.getAccountInfo(escrowPda);
    const vaultInfo = await connection.getAccountInfo(vault);
    expect(escrowInfo).to.equal(null);
    expect(vaultInfo).to.equal(null);
  });
});
