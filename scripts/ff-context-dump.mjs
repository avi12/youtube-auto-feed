(() => {
  const char = ytcfg?.get("INNERTUBE_CONTEXT")?.client ?? {};
  return {
    screenWidthPoints: char.screenWidthPoints,
    screenHeightPoints: char.screenHeightPoints,
    screenPixelDensity: char.screenPixelDensity,
    screenDensityFloat: char.screenDensityFloat,
    utcOffsetMinutes: char.utcOffsetMinutes,
    clientName: char.clientName,
    clientVersion: char.clientVersion,
    platform: char.platform,
    allClientKeys: Object.keys(char)
  };
})();
