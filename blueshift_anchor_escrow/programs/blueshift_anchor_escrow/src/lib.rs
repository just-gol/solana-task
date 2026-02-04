use anchor_lang::prelude::*;

declare_id!("6GNxX3PgZuHG3gi9o1gjye1CyyC3eVCTVGMQnV7EBnV7");

pub mod errors;
pub mod instructions;
pub mod state;
pub use instructions::*;

#[program]
pub mod blueshift_anchor_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, receive: u64, amount: u64) -> Result<()> {
        instructions::make::handler(ctx, seed, receive, amount)
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        instructions::take::handler(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handler(ctx)
    }
}
