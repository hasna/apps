// The @hasna/contracts storage client seam, used from the package rather than
// vendored. Previous versions of this file carried a byte-faithful vendored
// copy of the 0.5.0-era storage client. Re-exporting the shared package keeps
// credential resolution on the maintained code path.
export * from "@hasna/contracts/client/storage";
