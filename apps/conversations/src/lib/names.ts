/**
 * Pool of unique agent names for auto-assignment.
 * Format: adjective-animal, keeping them short, memorable, and fun.
 */
export const AGENT_NAMES = [
  // A
  "amber-fox", "arctic-wolf", "ashen-crow", "azure-hawk", "astral-lynx",
  "autumn-bear", "agile-puma", "alpine-ibex", "ancient-owl", "aqua-otter",
  "arid-viper", "atom-finch", "auburn-deer", "aurora-seal", "avid-mink",
  // B
  "blaze-tiger", "bright-heron", "bronze-eagle", "brisk-hare", "burnt-moth",
  "bold-raven", "blue-whale", "boreal-fox", "brass-cobra", "brave-ram",
  "brick-crane", "brief-newt", "briny-crab", "broad-elk", "brook-dove",
  // C
  "calm-panda", "cedar-jay", "chief-lion", "chrome-bat", "civic-wren",
  "clear-swan", "cliff-goat", "coal-shark", "cold-crane", "copper-jay",
  "coral-fish", "crisp-lark", "cross-mole", "cubic-wasp", "cyan-toad",
  // D
  "dark-stag", "dawn-robin", "deep-squid", "delta-fox", "dense-boar",
  "dew-spider", "dim-gecko", "draft-bear", "drift-gull", "dry-newt",
  "dual-crane", "dune-mouse", "dusk-moth", "dusty-mule", "dwarf-carp",
  // E
  "east-falcon", "echo-parrot", "edge-shark", "elm-beetle", "ember-lynx",
  "epoch-crane", "even-pike", "extra-ant", "elder-stork", "ebon-crow",
  "ever-finch", "exact-moth", "exile-wren", "equal-dove", "etch-hare",
  // F
  "faint-orca", "far-condor", "fern-mouse", "fierce-yak", "first-kite",
  "fjord-seal", "flint-wolf", "fog-parrot", "forge-bull", "fossil-ray",
  "frank-mink", "free-eagle", "fresh-colt", "frost-bear", "fuse-wasp",
  // G
  "gale-hawk", "gem-turtle", "ghost-lynx", "gilt-robin", "glad-moose",
  "glass-eel", "gleam-puma", "glyph-owl", "gold-crane", "gorge-lion",
  "grain-duck", "grand-wolf", "gray-fox", "green-hare", "grit-shark",
  // H
  "half-stork", "haze-panther", "heart-dove", "helm-eagle", "herb-toad",
  "hex-spider", "high-falcon", "hive-hornet", "holo-swan", "hood-cobra",
  "horn-bison", "huge-squid", "hull-crab", "hunt-marten", "husk-moth",
  // I
  "ice-leopard", "idle-crane", "inch-beetle", "indigo-jay", "inner-fox",
  "ion-parrot", "iron-bull", "isle-pelican", "ivory-hawk", "ivy-snake",
  "iota-wren", "ink-raven", "ignite-ram", "inert-slug", "infra-mole",
  // J
  "jade-tiger", "jest-magpie", "jewel-crane", "joint-boar", "jovial-elk",
  "jump-frog", "jungle-cat", "jury-dove", "just-heron", "jolt-wasp",
  // K
  "keen-osprey", "kelp-seal", "key-falcon", "kind-panda", "knot-viper",
  "kraft-bear", "kite-mouse", "knoll-deer", "know-crane", "karma-wolf",
  // L
  "lake-otter", "lapis-jay", "last-condor", "leaf-gecko", "lean-coyote",
  "light-lynx", "lime-parrot", "live-eagle", "long-crane", "lost-fox",
  "loud-finch", "low-shark", "luck-rabbit", "lunar-owl", "lush-ibis",
  // M
  "malt-badger", "maple-wren", "mars-falcon", "matte-crow", "mesa-hawk",
  "mild-orca", "mint-dove", "mist-puma", "mock-robin", "mono-wolf",
  "moon-bear", "moss-turtle", "mud-heron", "mute-swan", "myth-lynx",
  // N
  "navy-eagle", "near-mink", "neon-parrot", "nest-crane", "next-fox",
  "nimble-ram", "node-spider", "noon-hawk", "north-seal", "nova-owl",
  "null-moth", "numb-carp", "nutmeg-jay", "neat-cobra", "nomad-elk",
  // O
  "oak-badger", "oat-finch", "odd-pelican", "olive-bear", "onyx-raven",
  "opal-crane", "open-wolf", "orbit-lynx", "ore-shark", "outer-dove",
  // P
  "pale-tiger", "park-heron", "peak-eagle", "pine-fox", "pixel-owl",
  "plain-goat", "plum-crane", "polar-ray", "port-falcon", "prime-wolf",
  "prism-jay", "proud-lion", "pulse-bat", "pure-swan", "pyro-hawk",
  // Q
  "quake-bear", "quartz-jay", "quest-falcon", "quick-otter", "quiet-crane",
  // R
  "rain-leopard", "rapid-hare", "raw-condor", "reef-dolphin", "regal-stag",
  "ridge-fox", "rift-cobra", "rigid-crane", "river-otter", "rock-eagle",
  "root-mole", "rose-finch", "rough-boar", "ruby-hawk", "rust-wolf",
  // S
  "sage-owl", "salt-crane", "sand-viper", "satin-dove", "scale-dragon",
  "scarlet-ibis", "sea-falcon", "shade-lynx", "sharp-eagle", "shell-crab",
  "short-fox", "sigma-jay", "silk-moth", "silver-wolf", "slate-bear",
  "slim-heron", "smoke-puma", "snap-turtle", "snow-leopard", "solar-crane",
  "solid-ram", "sonic-bat", "south-seal", "spark-robin", "spice-wren",
  "split-mink", "spring-elk", "squid-ink", "stark-crow", "steel-hawk",
  "stern-bull", "still-swan", "stone-fox", "storm-eagle", "stout-boar",
  "stray-cat", "strong-lion", "sun-parrot", "surf-dolphin", "swift-deer",
  // T
  "teal-crane", "terra-wolf", "thick-bear", "thin-spider", "third-owl",
  "thorn-fox", "tide-seal", "timber-jay", "tiny-wren", "toast-mole",
  "topaz-hawk", "torch-lynx", "trace-falcon", "true-eagle", "tusk-walrus",
  // U
  "ultra-crane", "umbra-wolf", "unit-fox", "upper-hawk", "urban-jay",
  // V
  "vale-deer", "vast-eagle", "vault-bear", "velvet-owl", "vent-crane",
  "verse-fox", "vigor-lynx", "vine-parrot", "vivid-swan", "void-raven",
  "volt-hawk", "vow-falcon", "vintage-jay", "vista-wolf", "vital-hare",
  // W
  "warm-otter", "wave-dolphin", "wax-crane", "west-falcon", "wheat-mouse",
  "white-tiger", "wide-eagle", "wild-fox", "wind-hawk", "wire-spider",
  "wise-owl", "wood-thrush", "wool-ram", "wren-song", "wry-crow",
  // X
  "xeno-crane", "xerus-fox",
  // Y
  "yarn-robin", "yew-falcon", "young-wolf",
  // Z
  "zeal-hawk", "zen-panda", "zero-crane", "zinc-eagle", "zone-fox",
] as const;

export type AgentName = typeof AGENT_NAMES[number];
