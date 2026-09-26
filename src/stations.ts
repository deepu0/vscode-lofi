export interface Station {
  id: string;
  name: string;
  genre: string;
  /** Direct HTTPS audio stream (MP3). */
  streamUrl: string;
  homepage: string;
}

/** Built-in stations. See docs/decisions.md (Q18) for sourcing notes. */
export const BUILT_IN_STATIONS: readonly Station[] = [
  {
    id: "somafm-fluid",
    name: "SomaFM Fluid",
    genre: "Instrumental hip-hop",
    streamUrl: "https://ice.somafm.com/fluid-128-mp3",
    homepage: "https://somafm.com/fluid/",
  },
  {
    id: "laut-lofi",
    name: "laut.fm lofi",
    genre: "Lofi",
    streamUrl: "https://stream.laut.fm/lofi",
    homepage: "https://laut.fm/lofi",
  },
  {
    id: "reyfm-lofi",
    name: "REYFM #lofi",
    genre: "Lofi",
    streamUrl: "https://listen.reyfm.de/lofi_320kbps.mp3",
    homepage: "https://www.reyfm.de/",
  },
  {
    id: "ilm-chillhop",
    name: "I Love Chillhop",
    genre: "Chillhop",
    streamUrl: "https://ilm.stream12.radiohost.de/ilm_ilovechillhop_mp3-192",
    homepage: "https://www.ilovemusic.de/ilovechillhop/",
  },
  {
    id: "somafm-groovesalad",
    name: "SomaFM Groove Salad",
    genre: "Ambient downtempo",
    streamUrl: "https://ice.somafm.com/groovesalad-128-mp3",
    homepage: "https://somafm.com/groovesalad/",
  },
  {
    id: "somafm-lush",
    name: "SomaFM Lush",
    genre: "Chill vocals",
    streamUrl: "https://ice.somafm.com/lush-128-mp3",
    homepage: "https://somafm.com/lush/",
  },
  {
    id: "somafm-beatblender",
    name: "SomaFM Beat Blender",
    genre: "Deep house / downtempo",
    streamUrl: "https://ice.somafm.com/beatblender-128-mp3",
    homepage: "https://somafm.com/beatblender/",
  },
  {
    id: "somafm-sonicuniverse",
    name: "SomaFM Sonic Universe",
    genre: "Space jazz",
    streamUrl: "https://ice.somafm.com/sonicuniverse-128-mp3",
    homepage: "https://somafm.com/sonicuniverse/",
  },
  {
    id: "somafm-dronezone",
    name: "SomaFM Drone Zone",
    genre: "Ambient",
    streamUrl: "https://ice.somafm.com/dronezone-128-mp3",
    homepage: "https://somafm.com/dronezone/",
  },
  {
    id: "somafm-spacestation",
    name: "SomaFM Space Station Soma",
    genre: "Ambient / spacemusic",
    streamUrl: "https://ice.somafm.com/spacestation-128-mp3",
    homepage: "https://somafm.com/spacestation/",
  },
];

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isHttpUrl = (v: string): boolean => /^https?:\/\//i.test(v.trim());

/**
 * Merge user-provided custom stations (from the `lofiRadio.customStations`
 * setting) with the built-in list. Invalid entries are skipped and reported in
 * `problems`. Ids are de-duplicated (built-ins win; a colliding custom id is
 * prefixed with `custom-` so it stays unique). This function is deliberately
 * free of any `vscode` import so `stations.ts` stays the pure, swappable seam;
 * the caller reads the config value and passes it in as `customStations`.
 */
export function resolveStations(config: { customStations?: unknown }): {
  stations: Station[];
  problems: string[];
} {
  const problems: string[] = [];
  const stations: Station[] = [...BUILT_IN_STATIONS];
  const seenIds = new Set(BUILT_IN_STATIONS.map((s) => s.id));

  const raw = config.customStations;
  if (raw === undefined || raw === null) {
    return { stations, problems };
  }
  if (!Array.isArray(raw)) {
    problems.push("lofiRadio.customStations must be an array; ignoring it.");
    return { stations, problems };
  }

  raw.forEach((entry, i) => {
    const label = `custom station #${i + 1}`;
    if (typeof entry !== "object" || entry === null) {
      problems.push(`${label}: must be an object; skipped.`);
      return;
    }
    const e = entry as Record<string, unknown>;
    if (!isNonEmptyString(e.id)) {
      problems.push(`${label}: "id" must be a non-empty string; skipped.`);
      return;
    }
    if (!isNonEmptyString(e.name)) {
      problems.push(`${label} ("${e.id}"): "name" must be a non-empty string; skipped.`);
      return;
    }
    if (!isNonEmptyString(e.streamUrl) || !isHttpUrl(e.streamUrl)) {
      problems.push(`${label} ("${e.id}"): "streamUrl" must be an http(s) URL; skipped.`);
      return;
    }

    let id = e.id.trim();
    if (seenIds.has(id)) {
      const prefixed = `custom-${id}`;
      if (seenIds.has(prefixed)) {
        problems.push(`${label} ("${id}"): duplicate id; skipped.`);
        return;
      }
      problems.push(`${label} ("${id}"): id already in use; renamed to "${prefixed}".`);
      id = prefixed;
    }
    seenIds.add(id);

    stations.push({
      id,
      name: e.name.trim(),
      genre: isNonEmptyString(e.genre) ? e.genre.trim() : "Custom",
      streamUrl: e.streamUrl.trim(),
      homepage: isNonEmptyString(e.homepage) ? e.homepage.trim() : "",
    });
  });

  return { stations, problems };
}
