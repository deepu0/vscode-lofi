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
];
