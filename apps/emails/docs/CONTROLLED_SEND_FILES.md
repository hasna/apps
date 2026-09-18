# Controlled send files

`emails send-controlled apply` and `readback` support Linux and macOS. Inputs and receipt parents must be real private directories with mode 0700; descriptor/body/attachment files must be regular mode-0600 files owned by the effective user. macOS also rejects hard-linked input files and ACL grants on files, directories or ancestors. Deny-only ACL entries remain valid.

The macOS implementation uses the same reviewed libc operations as attachment downloads. It holds the receipt parent descriptor through API execution and uses descriptor-relative no-follow opens and atomic hard-link publication. Publication never replaces an existing receipt. File and parent identities, link counts and ACLs are revalidated; file and directory metadata are synced. A changed parent or failed publication leaves the private pending reservation for reconciliation and reports an uncertain receipt outcome rather than automatically sending again.

Receipts contain only safe request identity and provider outcome metadata. Reuse the original idempotency key for readback after an uncertain result. A missing receipt is not proof that the provider did not accept the message. The Linux implementation remains unchanged.

For a threaded reply, set the optional descriptor field `reply_to_message_id` to
the exact parent message record ID in your authenticated tenant. Keep the intended
`from`, `to`, `cc`, `bcc`, subject and body explicit in the descriptor. The parent
must authorize the sender as a participant, and the subject must retain the
parent's subject with an optional `Re:` prefix. The API derives `In-Reply-To` and
`References` from the parent's actual RFC Message-ID evidence; do not substitute
a provider ID or manufacture transport headers. The descriptor does not accept
custom headers. `reply_to` remains the separate mailbox address for receiving replies.

`apply` verifies that the API advertises the typed parent field before submitting
the send. Missing, invalid or unreachable capability metadata refuses before any
send request. The parent ID is passed unchanged and stays part of the server's
idempotent payload; changing it requires a new, separately authorized request.
`readback` only looks up the original idempotency key. It does not read body or
attachment files, check reply capability, fetch the parent, or send a message.

Regression coverage uses an authenticated synthetic API, not real email delivery: ordinary send/replay/readback, provider warning, receipt mode/atomic publication, existing receipt preservation, ACL grant rejection, deny-only ACL acceptance, hard-link rejection, and receipt-parent replacement during a delayed provider call. The attachment native suite verifies the shared primitive extraction.
