use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Refund<'info> {
    // TODO: add required accounts for refund flow
}

pub fn handler(_ctx: Context<Refund>) -> Result<()> {
    Ok(())
}
