import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PreReqVault } from "../target/types/pre_req_vault";
import {
  Commitment,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";

const commitement: Commitment = "confirmed";
const registrationIdl: anchor.Idl = require("../idls/registration.json");
const registrationCoder = new anchor.BorshAccountsCoder(registrationIdl);

describe("pre-req-vault", function () {
  this.bail(true);
  this.retries(0);
  let registrationVerified = false;
  const confirmTx = async (signature: string) => {
    console.log(`Transaction signature: ${signature}`);
  };

  const environmentProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      environmentProvider.connection.rpcEndpoint,
      "confirmed"
    ),
    environmentProvider.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.preReqVault as Program<PreReqVault>;
  const user = provider.wallet.publicKey;
  const applicationProgram = new PublicKey(registrationIdl.address);
  const [applicationAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("prereqs"), user.toBuffer()],
    applicationProgram
  );

  // Derive PDAs

  const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state"), user.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultStatePda.toBuffer()],
    program.programId
  );

  before(async () => {
    const existingRegistration = await provider.connection.getAccountInfo(
      applicationAccount,
      commitement
    );
    expect(
      existingRegistration,
      "This wallet already has a registration account; stop before sending transactions."
    ).to.be.null;
  });

  it("Initialize the vault", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.vaultBump).to.equal(vaultBump);
    expect(vaultState.stateBump).to.equal(stateBump);
  });

  it(" Deposilt 1 Sol in to the vault", async () => {
    const depositAmount = 1 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .deposit(new BN(depositAmount))
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance + depositAmount);
    expect(finalBalanceUser).to.be.lessThan(intialUserBalance - depositAmount);
  });

  it(" Withdraw 0.5 Sol from the vault", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .withdraw(new BN(withdrawAmount))
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        applicationAccount,
        applicationProgram,
      })
      .rpc();

    await confirmTx(tx);

    const registrationInfo = await provider.connection.getAccountInfo(
      applicationAccount,
      commitement
    );
    expect(registrationInfo, "Withdrawal must create the registration account")
      .to.not.be.null;
    expect(registrationInfo!.owner.toBase58()).to.equal(
      applicationProgram.toBase58()
    );
    // decode checks the account discriminator from the supplied IDL.
    const registration = registrationCoder.decode(
      "ApplicationAccount",
      registrationInfo!.data
    );
    expect(registration.github).to.equal("SomeshTalligeriDEV");
    expect(registration.user.toBase58()).to.equal(user.toBase58());
    registrationVerified = true;
    console.log(
      "Verified registration:",
      JSON.stringify({
        address: applicationAccount.toBase58(),
        user: registration.user.toBase58(),
        github: registration.github,
        bump: registration.bump,
        pre_req_ts: registration.pre_req_ts,
        pre_req_rs: registration.pre_req_rs,
      })
    );

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance - withdrawAmount);
    expect(finalBalanceUser).to.be.greaterThan(intialUserBalance);
  });

  it(" Close the vault and withdraw all the funds", async () => {
    expect(
      registrationVerified,
      "Verify registration before closing the vault"
    ).to.equal(true);
    const initialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .close()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    expect(await provider.connection.getBalance(vaultPda)).to.equal(0);

    const vaultStateInfo = await provider.connection.getAccountInfo(
      vaultStatePda
    );
    expect(vaultStateInfo).to.be.null;

    const finalUserBalance = await provider.connection.getBalance(user);
    expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
  });
});
