# Deployments

Stellar testnet resets quarterly, which wipes all deployed contracts and transaction history. The transaction hashes and contract ID below reflect the testnet deployment at the time of recording.

If testnet has been reset since, follow the [testnet reset runbook](runbook-testnet-reset.md#stellar-testnet-resets-quarterly) to redeploy or re-run `npm run e2e` to verify fresh on-chain transactions.

| Tag                         | Contract ID                                                | Schema Version | `verification_key.json` SHA-256                                    | `create_circle` TX (circle 0)                                      | Accepted Proof TX                                                  |
| --------------------------- | ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| July 2026 (Stale, 3-signal) | `CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF` | v1             | `unknown`                                                          | `fa76e7fe7439199796db55fdde4bcaaad2cb6a98c0f29214d00605f40ca8fdb0` | `2258397474e3ad420d6dd8310cb0976d270c29ec4a4ec2b60a9ae58408088087` |
| Current (Testnet, 4-signal) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | v2             | `2e439890c63dcb186d2a8a3220c980eb989e705ea4b2c75600a33a8a9bf8f53c` | `1b42398457ab890c2834baf57f4902347910283c7b2a9584736f901ab384758d` | `2a948347f8a920b72183c57a91820b832a819b5830219ca7b90213894bc02814` |
