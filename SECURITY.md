# Security: what each part refuses, and the proof

Just Cents version 2 pays every accepted specialist into its own small P2SH32 contract (`src/core/htlc.ts`):

```
<sealed file fingerprint> OP_DROP
OP_IF                                   claim: [signature, K, 1]
  OP_SHA256 <keyHash> OP_EQUALVERIFY      the file key K opens the lock
  <specialist claim key> OP_CHECKSIG      and the specialist signs
OP_ELSE                                 refund: [0], no signature at all
  <refundTime> OP_CHECKLOCKTIMEVERIFY OP_DROP                       not before refundTime (chain median time)
  OP_INPUTINDEX OP_OUTPUTBYTECODE <buyer> OP_EQUALVERIFY            the output at my index pays the buyer
  OP_INPUTINDEX OP_OUTPUTVALUE OP_INPUTINDEX OP_UTXOVALUE 500 OP_SUB OP_GREATERTHANOREQUAL   at least my value − 500
OP_ENDIF
```

Every row below names what refuses the attack and how that was shown: tests (`test/<name>.test.ts`, each claim and refund
run through the libauth BCH 2026 virtual machine), mutants (one change to the code that must make a test fail — all
listed mutants were killed), and transactions on chain. "chipnet" rows are the test network; "mainnet" rows are real
money.

## The contract

| Attack | What refuses it | Proof |
|---|---|---|
| Claim with a wrong key | `OP_SHA256 <keyHash> OP_EQUALVERIFY` in the contract | test `htlc` "claim: a wrong key is refused, even with the specialist signature" (VM: `OP_VERIFY`); mutants M1 key not compared, M2 key not hashed |
| Claim with someone else's signature (the right key, learnt from another claim) | `<claim key> OP_CHECKSIG`; the signature covers the whole transaction (`SIGHASH_ALL\|FORKID`) | test `htlc` "claim: the right key with someone else's signature is refused" (VM: `NULLFAIL`); mutants M3 signature not checked, M13 sighash without fork id |
| Refund before its time | `OP_CHECKLOCKTIMEVERIFY` on a time lock (median time past), and the node's finality rule | tests `htlc` "refund before the refund time is refused", "refund with a final sequence is refused"; mutants M4 no time lock, M11 final sequence, M21 one second early, M22 median = newest header, M23 block heights accepted; **chipnet**: refund of `db69af79…2fcc` and of `d469286a…5e39` refused by the node: `bad-txns-nonfinal, non-final transaction (code 64)`; **mainnet**: refund of payment `29c9b46fa5e5a67189c6e4bba685da1546d9c532f18f8ead8413f5e4742690dc`, sent one second after it at chain time 01:43:46Z (refund time 02:43:46Z), refused by the node: `the transaction was rejected by network rules. bad-txns-nonfinal, non-final transaction (code 64)` |
| Refund paid to someone other than the buyer | `OP_OUTPUTBYTECODE <buyer> OP_EQUALVERIFY` | test `htlc` "refund to anyone but the buyer is refused"; mutants M5 refund output not checked, M7 output index fixed; **chipnet**: after the refund time, a refund of `db69af79…2fcc` and of `d469286a…5e39` paying the service address refused: `mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16)` |
| Refund that keeps part of the money as "fee" | output value ≥ contract value − 500 | test `htlc` "refund paying the buyer less than the value minus the fixed fee is refused"; mutants M6 value not checked, M8 cap 500→5000, M9 ≥ → > |
| Two contracts paid back through one output (the second contract's money sent elsewhere) | each input checks the output at its own index | test `htlc` "two contracts cannot share one refund output"; mutant M7 |
| The refund needs the buyer's (or anyone's) signature, so a lost wallet loses the money | the refund branch has no signature: anyone may send it, it can only pay the buyer | test `htlc` "refund from the refund time pays the buyer, with no signature"; test `refund-demo` "the refund needs no signature, pays the buyer…"; **chipnet** refunds `275d416a…7740` and `babcf771345eaac8404a533ab48f6830db713a963236ff6ae30961b1ac452246` (5 016 sat back, fee 240) |
| Paying twice for one claim, or a second claim | a contract output can be spent once; the claim is deterministic, so asking again gives the same transaction ("already known") | tests `htlc` "the claim is deterministic", `claim-endpoint` "a repeated request gives the same claim"; **chipnet**: 10 requests in a row for one payment → 10 × the same claim `13d4a084…b098` |

## The specialist's side (`worker/claim.ts`, the same code in every claim server)

| Attack | What refuses it | Proof |
|---|---|---|
| The buyer pays less than the price (+500 for the claim's fee) | the claim server checks the contract's value before revealing anything; an unclaimed contract only goes back to the buyer | test `htlc` "the specialist refuses: offer not in the note, underpaid, too close to the refund, keys it does not hold"; mutants M16 amount ignored, M20 contract value without the fee |
| The buyer waits for the key, then races a refund | the server reveals its key only with ≥ 600 s of chain time left before the refund opens | test `claim-endpoint` "too close to the refund time: 409 and nothing is broadcast"; mutants M12, M17 margin ignored |
| A payment that names another offer, or none | the payment's JC2 note must list this offer; the contract is rebuilt from the note and must be in the transaction | test `htlc` (same as above), mutant M15 offer listing ignored |
| The server is asked without its keys | 503, the network is never read | test `claim-endpoint` "without its keys the server refuses (503)"; mutant M18 |
| An open specialist's server answering for the demo offers, or the reverse | each server claims only from the book it is given; an unknown or inherited name (`__proto__`) is not an offer | test `specialist` "the template worker claims only the stranger's own offers…"; mutants S1 per-network book ignored, S2 lookup without `hasOwn`, S3 template worker without a book |
| A stolen claim server | it holds only the claim key and the file-key seed: a thief can claim already-paid contracts (the buyer still gets the key) but cannot sign new offers — the offer key never leaves the specialist's machine | design: `scripts/specialist-keys.ts` writes the offer key to `.env.offer`, the server's secrets to `.dev.vars`; check `verify-specialist` "the claim key is not the offer key" (mutant S7) |

## The file

| Attack | What refuses it | Proof |
|---|---|---|
| The sealed file is swapped (on the server, in transit) | before paying, the page compares sha256 of the sealed file with the fingerprint in the signed offer; AES-GCM's 16-byte tag refuses a changed byte | tests `htlc` "a wrong key or a changed byte does not open it", `offers-v2` "sealed file matches", `specialist` "…a changed sealed file… each fails its check"; mutants D10 sealed fingerprint not checked, M19 tag 16→4 bytes, S5 |
| A claim whose "key" does not open the lock is read as the key | the page takes the key only from a claim input whose sha256 equals the lock | test `htlc` "a claim carrying a key that does not match the lock is not read as a key"; mutants M10, D18 |
| A forged or changed offer (price, payout address, lock, sealed fingerprint, claim key) | Schnorr signature over the offer's fixed canonical form; the page and `verify-specialist` check it | tests `htlc` "sign and verify with the offer key; changing the lock, the sealed fingerprint or the claim key breaks the signature", `specialist` "a changed price…"; mutants S4, S6, S15 |
| **The specialist seals and signs the wrong file on purpose** | **not refused by the chain.** The swap "key ↔ money" is atomic; that the key opens exactly the promised work would need a zero-knowledge proof. What there is: the page checks the opened file's fingerprint and the published rules after opening; the specialist's claim signature on chain covers the contract that carries that sealed file's fingerprint — public proof of who sold what. The money does not come back automatically. | test `htlc` "specialist claims … → the file opens and matches"; README "Paying into a contract" |
| A standing offer's key, once claimed, opens the sealed file for anyone | by design for the demo specialists (the same file for every buyer); for one-buyer work a specialist signs an offer for that one order | README, `specialists/template/README.md` "Good to know" |

## Mutation runs
- Contract, claim server, filebox, payment: 23 of 23 mutants killed (M1–M23).
- Sealed-file download and the page's claim retries: 21 of 21 (D1–D21).
- Open-specialist template and refund demo: 19 of 20 killed (S1–S17, S19, S20); S18 (refund demo offer lookup without
  `hasOwn`) behaves the same either way — an inherited name has no version 2 offer and is refused with the same message.
