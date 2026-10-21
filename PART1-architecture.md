# Part 1 architecture

## Diagram

![Vault instructions and the withdrawal-to-registration CPI sequence](arch.png)

The diagram summarizes the sequence. The wallet signs transactions containing instructions. During initialization, only the state account is created; the vault address is validated and receives SOL on deposit. On close, the remaining vault SOL moves through the System Program, while Anchor refunds the state account rent directly.

## Accounts and authority

| Component | Role |
| --- | --- |
| User wallet | Signs vault requests and pays transaction fees and account-creation rent. |
| Vault program | Validates wallet-specific PDA constraints and coordinates the transfers and registration CPI. |
| Vault state PDA | Owned by the vault program; stores `state_bump` and `vault_bump` (10 bytes including the discriminator). |
| Vault PDA | System Program-owned account that holds SOL; the vault program supplies its signer seeds for outgoing transfers. |
| Registration PDA | Derived under and initialized by the registration program; stores the wallet and GitHub username along with registration fields. |
| System Program | Executes SOL transfers and account creation. |

## Address derivation

- State: `[b"state", user public-key bytes]` under the vault program.
- Vault: `[b"vault", state public-key bytes]` under the vault program.
- Registration: `[b"prereqs", user public-key bytes]` under the registration program.

Each derivation includes its bump and program ID. A PDA has no private key. The runtime grants PDA signer privilege for CPI when the calling program supplies matching seeds.

## Application flow

`initialize → deposit → withdraw → verify registration → close`

Within `withdraw`, the first CPI transfers SOL from the vault PDA to the wallet through the System Program. The second CPI invokes registration's `initialize` with `SomeshTalligeriDEV`, using the wallet's propagated signer privilege. The supplied `idls/registration.json` generates the Rust CPI interface through `declare_program!(registration)`.

The registration account is unchecked by the outer instruction because the registration program creates it. Its address is constrained to the expected registration PDA, and the typed registration program account pins the target program ID. The registration program performs its own initialization checks.

Both CPIs belong to one transaction: a propagated error rolls back their state changes. The test suite checks the registration account's existence, owner, discriminator, exact username, and wallet before allowing `close`. It stops after the first failure and disables test retries.

## Verified Part 1 result

- Vault program: `FxogU7GPL6uKMjbY9bNswLtvyHXxKJitopTD9pRp29C` on devnet.
- Registration program: `TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM`.
- Registered wallet: `4jSwWFZ3Qv95QWVSHu411cBYnvMrsDJyiQCmm8KEpW2P`.
- Registration PDA: `E8dTZtAVuGfGWwyJEoFzhgvjbxMpzXd3tfKbDi5wQMWn`, bump `254`.
- GitHub username: `SomeshTalligeriDEV`.
- Observed registration account allocation: 72 bytes.
- `pre_req_ts` and `pre_req_rs` were both `false`: registration does not itself call the separate submission instructions in the IDL.
- The vault and state accounts were closed only after registration verification. The registration account remains.
