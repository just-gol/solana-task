use crate::errors::VaultError;
use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
      mut,
      seeds = [b"vault",signer.key().as_ref()],
      bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
    let vault_lamports = ctx.accounts.vault.lamports();
    require!(vault_lamports > 0, VaultError::InvalidAmount);
    let binding = ctx.accounts.signer.key();
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", &binding.as_ref(), &[ctx.bumps.vault]]];

    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.signer.to_account_info(),
            },
            signer_seeds,
        ),
        vault_lamports,
    )?;

    Ok(())
}
