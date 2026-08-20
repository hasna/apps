---
"@hasna/shortlinks": patch
---

CLI output projects signed capability destination URLs (S3/GCS presigned, CloudFront signed) to their plain unsigned reference — capability query parameters are stripped before any output surface (human, JSON, verbose, resolve, stats). Incident 716957 / todos b03cc058: a stored destination that was itself a presigned read URL was previously emitted verbatim into CLI output and reproduced in session transcripts, granting bearer read access until expiry.
