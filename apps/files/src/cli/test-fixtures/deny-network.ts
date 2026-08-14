const denyNetwork = async (..._args: Parameters<typeof fetch>): Promise<Response> => {
  throw new Error("Network access is disabled in source removal CLI tests");
};

denyNetwork.preconnect = (..._args: Parameters<typeof fetch.preconnect>): void => {
  throw new Error("Network preconnect is disabled in source removal CLI tests");
};

globalThis.fetch = denyNetwork;
