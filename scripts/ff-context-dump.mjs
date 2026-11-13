(() => {
  const c = ytcfg?.get("INNERTUBE_CONTEXT")?.client ?? {};
  return {
    screenWidthPoints: c.screenWidthPoints,
    screenHeightPoints: c.screenHeightPoints,
    screenPixelDensity: c.screenPixelDensity,
    screenDensityFloat: c.screenDensityFloat,
    utcOffsetMinutes: c.utcOffsetMinutes,
    clientName: c.clientName,
    clientVersion: c.clientVersion,
    platform: c.platform,
    allClientKeys: Object.keys(c)
  };
})()
