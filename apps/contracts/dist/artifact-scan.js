// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/artifact-scan.ts
import { createHash, randomBytes } from "crypto";
import { existsSync, readFileSync, readdirSync, rmSync as rmSync2, statSync } from "fs";
import { basename, join as join2, relative } from "path";

// src/tlds.ts
var IANA_TLDS = [
  "aaa",
  "aarp",
  "abb",
  "abbott",
  "abbvie",
  "abc",
  "able",
  "abogado",
  "abudhabi",
  "ac",
  "academy",
  "accenture",
  "accountant",
  "accountants",
  "aco",
  "actor",
  "ad",
  "ads",
  "adult",
  "ae",
  "aeg",
  "aero",
  "aetna",
  "af",
  "afl",
  "africa",
  "ag",
  "agakhan",
  "agency",
  "ai",
  "aig",
  "airbus",
  "airforce",
  "airtel",
  "akdn",
  "al",
  "alibaba",
  "alipay",
  "allfinanz",
  "allstate",
  "ally",
  "alsace",
  "alstom",
  "am",
  "amazon",
  "americanexpress",
  "americanfamily",
  "amex",
  "amfam",
  "amica",
  "amsterdam",
  "analytics",
  "android",
  "anquan",
  "anz",
  "ao",
  "aol",
  "apartments",
  "app",
  "apple",
  "aq",
  "aquarelle",
  "ar",
  "arab",
  "aramco",
  "archi",
  "army",
  "arpa",
  "art",
  "arte",
  "as",
  "asda",
  "asia",
  "associates",
  "at",
  "athleta",
  "attorney",
  "au",
  "auction",
  "audi",
  "audible",
  "audio",
  "auspost",
  "author",
  "auto",
  "autos",
  "aw",
  "aws",
  "ax",
  "axa",
  "az",
  "azure",
  "ba",
  "baby",
  "baidu",
  "banamex",
  "band",
  "bank",
  "bar",
  "barcelona",
  "barclaycard",
  "barclays",
  "barefoot",
  "bargains",
  "baseball",
  "basketball",
  "bauhaus",
  "bayern",
  "bb",
  "bbc",
  "bbt",
  "bbva",
  "bcg",
  "bcn",
  "bd",
  "be",
  "beats",
  "beauty",
  "beer",
  "berlin",
  "best",
  "bestbuy",
  "bet",
  "bf",
  "bg",
  "bh",
  "bharti",
  "bi",
  "bible",
  "bid",
  "bike",
  "bing",
  "bingo",
  "bio",
  "biz",
  "bj",
  "black",
  "blackfriday",
  "blockbuster",
  "blog",
  "bloomberg",
  "blue",
  "bm",
  "bms",
  "bmw",
  "bn",
  "bnpparibas",
  "bo",
  "boats",
  "boehringer",
  "bofa",
  "bom",
  "bond",
  "boo",
  "book",
  "booking",
  "bosch",
  "bostik",
  "boston",
  "bot",
  "boutique",
  "box",
  "br",
  "bradesco",
  "bridgestone",
  "broadway",
  "broker",
  "brother",
  "brussels",
  "bs",
  "bt",
  "build",
  "builders",
  "business",
  "buy",
  "buzz",
  "bv",
  "bw",
  "by",
  "bz",
  "bzh",
  "ca",
  "cab",
  "cafe",
  "cal",
  "call",
  "calvinklein",
  "cam",
  "camera",
  "camp",
  "canon",
  "capetown",
  "capital",
  "capitalone",
  "car",
  "caravan",
  "cards",
  "care",
  "career",
  "careers",
  "cars",
  "casa",
  "case",
  "cash",
  "casino",
  "cat",
  "catering",
  "catholic",
  "cba",
  "cbn",
  "cbre",
  "cc",
  "cd",
  "center",
  "ceo",
  "cern",
  "cf",
  "cfa",
  "cfd",
  "cg",
  "ch",
  "chanel",
  "channel",
  "charity",
  "chase",
  "chat",
  "cheap",
  "chintai",
  "christmas",
  "chrome",
  "church",
  "ci",
  "cipriani",
  "circle",
  "cisco",
  "citadel",
  "citi",
  "citic",
  "city",
  "ck",
  "cl",
  "claims",
  "cleaning",
  "click",
  "clinic",
  "clinique",
  "clothing",
  "cloud",
  "club",
  "clubmed",
  "cm",
  "cn",
  "co",
  "coach",
  "codes",
  "coffee",
  "college",
  "cologne",
  "com",
  "commbank",
  "community",
  "company",
  "compare",
  "computer",
  "comsec",
  "condos",
  "construction",
  "consulting",
  "contact",
  "contractors",
  "cooking",
  "cool",
  "coop",
  "corsica",
  "country",
  "coupon",
  "coupons",
  "courses",
  "cpa",
  "cr",
  "credit",
  "creditcard",
  "creditunion",
  "cricket",
  "crown",
  "crs",
  "cruise",
  "cruises",
  "cu",
  "cuisinella",
  "cv",
  "cw",
  "cx",
  "cy",
  "cymru",
  "cyou",
  "cz",
  "dad",
  "dance",
  "data",
  "date",
  "dating",
  "datsun",
  "day",
  "dclk",
  "dds",
  "de",
  "deal",
  "dealer",
  "deals",
  "degree",
  "delivery",
  "dell",
  "deloitte",
  "delta",
  "democrat",
  "dental",
  "dentist",
  "desi",
  "design",
  "dev",
  "dhl",
  "diamonds",
  "diet",
  "digital",
  "direct",
  "directory",
  "discount",
  "discover",
  "dish",
  "diy",
  "dj",
  "dk",
  "dm",
  "dnp",
  "do",
  "docs",
  "doctor",
  "dog",
  "domains",
  "dot",
  "download",
  "drive",
  "dtv",
  "dubai",
  "dupont",
  "durban",
  "dvag",
  "dvr",
  "dz",
  "earth",
  "eat",
  "ec",
  "eco",
  "edeka",
  "edu",
  "education",
  "ee",
  "eg",
  "email",
  "emerck",
  "energy",
  "engineer",
  "engineering",
  "enterprises",
  "epson",
  "equipment",
  "er",
  "ericsson",
  "erni",
  "es",
  "esq",
  "estate",
  "et",
  "eu",
  "eurovision",
  "eus",
  "events",
  "exchange",
  "expert",
  "exposed",
  "express",
  "extraspace",
  "fage",
  "fail",
  "fairwinds",
  "faith",
  "family",
  "fan",
  "fans",
  "farm",
  "farmers",
  "fashion",
  "fast",
  "fedex",
  "feedback",
  "ferrari",
  "ferrero",
  "fi",
  "fidelity",
  "fido",
  "film",
  "final",
  "finance",
  "financial",
  "fire",
  "firestone",
  "firmdale",
  "fish",
  "fishing",
  "fit",
  "fitness",
  "fj",
  "fk",
  "flickr",
  "flights",
  "flir",
  "florist",
  "flowers",
  "fly",
  "fm",
  "fo",
  "foo",
  "food",
  "football",
  "ford",
  "forex",
  "forsale",
  "forum",
  "foundation",
  "fox",
  "fr",
  "free",
  "fresenius",
  "frl",
  "frogans",
  "frontier",
  "ftr",
  "fujitsu",
  "fun",
  "fund",
  "furniture",
  "futbol",
  "fyi",
  "ga",
  "gal",
  "gallery",
  "gallo",
  "gallup",
  "game",
  "games",
  "gap",
  "garden",
  "gay",
  "gb",
  "gbiz",
  "gd",
  "gdn",
  "ge",
  "gea",
  "gent",
  "genting",
  "george",
  "gf",
  "gg",
  "ggee",
  "gh",
  "gi",
  "gift",
  "gifts",
  "gives",
  "giving",
  "gl",
  "glass",
  "gle",
  "global",
  "globo",
  "gm",
  "gmail",
  "gmbh",
  "gmo",
  "gmx",
  "gn",
  "godaddy",
  "gold",
  "goldpoint",
  "golf",
  "goodyear",
  "goog",
  "google",
  "gop",
  "got",
  "gov",
  "gp",
  "gq",
  "gr",
  "grainger",
  "graphics",
  "gratis",
  "green",
  "gripe",
  "grocery",
  "group",
  "gs",
  "gt",
  "gu",
  "gucci",
  "guge",
  "guide",
  "guitars",
  "guru",
  "gw",
  "gy",
  "hair",
  "hamburg",
  "hangout",
  "haus",
  "hbo",
  "hdfc",
  "hdfcbank",
  "health",
  "healthcare",
  "help",
  "helsinki",
  "here",
  "hermes",
  "hiphop",
  "hisamitsu",
  "hitachi",
  "hiv",
  "hk",
  "hkt",
  "hm",
  "hn",
  "hockey",
  "holdings",
  "holiday",
  "homedepot",
  "homegoods",
  "homes",
  "homesense",
  "honda",
  "horse",
  "hospital",
  "host",
  "hosting",
  "hot",
  "hotels",
  "hotmail",
  "house",
  "how",
  "hr",
  "hsbc",
  "ht",
  "hu",
  "hughes",
  "hyatt",
  "hyundai",
  "ibm",
  "icbc",
  "ice",
  "icu",
  "id",
  "ie",
  "ieee",
  "ifm",
  "ikano",
  "il",
  "im",
  "imamat",
  "imdb",
  "immo",
  "immobilien",
  "in",
  "inc",
  "industries",
  "infiniti",
  "info",
  "ing",
  "ink",
  "institute",
  "insurance",
  "insure",
  "int",
  "international",
  "intuit",
  "investments",
  "io",
  "ipiranga",
  "iq",
  "ir",
  "irish",
  "is",
  "ismaili",
  "ist",
  "istanbul",
  "it",
  "itau",
  "itv",
  "jaguar",
  "java",
  "jcb",
  "je",
  "jeep",
  "jetzt",
  "jewelry",
  "jio",
  "jll",
  "jm",
  "jmp",
  "jnj",
  "jo",
  "jobs",
  "joburg",
  "jot",
  "joy",
  "jp",
  "jpmorgan",
  "jprs",
  "juegos",
  "juniper",
  "kaufen",
  "kddi",
  "ke",
  "kerryhotels",
  "kerryproperties",
  "kfh",
  "kg",
  "kh",
  "ki",
  "kia",
  "kids",
  "kim",
  "kindle",
  "kitchen",
  "kiwi",
  "km",
  "kn",
  "koeln",
  "komatsu",
  "kosher",
  "kp",
  "kpmg",
  "kpn",
  "kr",
  "krd",
  "kred",
  "kuokgroup",
  "kw",
  "ky",
  "kyoto",
  "kz",
  "la",
  "lacaixa",
  "lamborghini",
  "lamer",
  "land",
  "landrover",
  "lanxess",
  "lasalle",
  "lat",
  "latino",
  "latrobe",
  "law",
  "lawyer",
  "lb",
  "lc",
  "lds",
  "lease",
  "leclerc",
  "lefrak",
  "legal",
  "lego",
  "lexus",
  "lgbt",
  "li",
  "lidl",
  "life",
  "lifeinsurance",
  "lifestyle",
  "lighting",
  "like",
  "lilly",
  "limited",
  "limo",
  "lincoln",
  "link",
  "live",
  "living",
  "lk",
  "llc",
  "llp",
  "loan",
  "loans",
  "locker",
  "locus",
  "lol",
  "london",
  "lotte",
  "lotto",
  "love",
  "lpl",
  "lplfinancial",
  "lr",
  "ls",
  "lt",
  "ltd",
  "ltda",
  "lu",
  "lundbeck",
  "luxe",
  "luxury",
  "lv",
  "ly",
  "ma",
  "madrid",
  "maif",
  "maison",
  "makeup",
  "man",
  "management",
  "mango",
  "map",
  "market",
  "marketing",
  "markets",
  "marriott",
  "marshalls",
  "mattel",
  "mba",
  "mc",
  "mckinsey",
  "md",
  "me",
  "med",
  "media",
  "meet",
  "melbourne",
  "meme",
  "memorial",
  "men",
  "menu",
  "merck",
  "merckmsd",
  "mg",
  "mh",
  "miami",
  "microsoft",
  "mil",
  "mini",
  "mint",
  "mit",
  "mitsubishi",
  "mk",
  "ml",
  "mlb",
  "mls",
  "mm",
  "mma",
  "mn",
  "mo",
  "mobi",
  "mobile",
  "moda",
  "moe",
  "moi",
  "mom",
  "monash",
  "money",
  "monster",
  "mormon",
  "mortgage",
  "moscow",
  "moto",
  "motorcycles",
  "mov",
  "movie",
  "mp",
  "mq",
  "mr",
  "ms",
  "msd",
  "mt",
  "mtn",
  "mtr",
  "mu",
  "museum",
  "music",
  "mv",
  "mw",
  "mx",
  "my",
  "mz",
  "na",
  "nab",
  "nagoya",
  "name",
  "navy",
  "nba",
  "nc",
  "ne",
  "nec",
  "net",
  "netbank",
  "netflix",
  "network",
  "neustar",
  "new",
  "news",
  "next",
  "nextdirect",
  "nexus",
  "nf",
  "nfl",
  "ng",
  "ngo",
  "nhk",
  "ni",
  "nico",
  "nike",
  "nikon",
  "ninja",
  "nissan",
  "nissay",
  "nl",
  "no",
  "nokia",
  "norton",
  "now",
  "nowruz",
  "nowtv",
  "np",
  "nr",
  "nra",
  "nrw",
  "ntt",
  "nu",
  "nyc",
  "nz",
  "obi",
  "observer",
  "office",
  "okinawa",
  "olayan",
  "olayangroup",
  "ollo",
  "om",
  "omega",
  "one",
  "ong",
  "onl",
  "online",
  "ooo",
  "open",
  "oracle",
  "orange",
  "org",
  "organic",
  "origins",
  "osaka",
  "otsuka",
  "ott",
  "ovh",
  "pa",
  "page",
  "panasonic",
  "paris",
  "pars",
  "partners",
  "parts",
  "party",
  "pay",
  "pccw",
  "pe",
  "pet",
  "pf",
  "pfizer",
  "pg",
  "ph",
  "pharmacy",
  "phd",
  "philips",
  "phone",
  "photo",
  "photography",
  "photos",
  "physio",
  "pics",
  "pictet",
  "pictures",
  "pid",
  "pin",
  "ping",
  "pink",
  "pioneer",
  "pizza",
  "pk",
  "pl",
  "place",
  "play",
  "playstation",
  "plumbing",
  "plus",
  "pm",
  "pn",
  "pnc",
  "pohl",
  "poker",
  "politie",
  "porn",
  "post",
  "pr",
  "praxi",
  "press",
  "prime",
  "pro",
  "prod",
  "productions",
  "prof",
  "progressive",
  "promo",
  "properties",
  "property",
  "protection",
  "pru",
  "prudential",
  "ps",
  "pt",
  "pub",
  "pw",
  "pwc",
  "py",
  "qa",
  "qpon",
  "quebec",
  "quest",
  "racing",
  "radio",
  "re",
  "read",
  "realestate",
  "realtor",
  "realty",
  "recipes",
  "red",
  "redumbrella",
  "rehab",
  "reise",
  "reisen",
  "reit",
  "reliance",
  "ren",
  "rent",
  "rentals",
  "repair",
  "report",
  "republican",
  "rest",
  "restaurant",
  "review",
  "reviews",
  "rexroth",
  "rich",
  "richardli",
  "ricoh",
  "ril",
  "rio",
  "rip",
  "ro",
  "rocks",
  "rodeo",
  "rogers",
  "room",
  "rs",
  "rsvp",
  "ru",
  "rugby",
  "ruhr",
  "run",
  "rw",
  "rwe",
  "ryukyu",
  "sa",
  "saarland",
  "safe",
  "safety",
  "sakura",
  "sale",
  "salon",
  "samsclub",
  "samsung",
  "sandvik",
  "sandvikcoromant",
  "sanofi",
  "sap",
  "sarl",
  "sas",
  "save",
  "saxo",
  "sb",
  "sbi",
  "sbs",
  "sc",
  "scb",
  "schaeffler",
  "schmidt",
  "scholarships",
  "school",
  "schule",
  "schwarz",
  "science",
  "scot",
  "sd",
  "se",
  "search",
  "seat",
  "secure",
  "security",
  "seek",
  "select",
  "sener",
  "services",
  "seven",
  "sew",
  "sex",
  "sexy",
  "sfr",
  "sg",
  "sh",
  "shangrila",
  "sharp",
  "shell",
  "shia",
  "shiksha",
  "shoes",
  "shop",
  "shopping",
  "shouji",
  "show",
  "si",
  "silk",
  "sina",
  "singles",
  "site",
  "sj",
  "sk",
  "ski",
  "skin",
  "sky",
  "skype",
  "sl",
  "sling",
  "sm",
  "smart",
  "smile",
  "sn",
  "sncf",
  "so",
  "soccer",
  "social",
  "softbank",
  "software",
  "sohu",
  "solar",
  "solutions",
  "song",
  "sony",
  "soy",
  "spa",
  "space",
  "sport",
  "spot",
  "sr",
  "srl",
  "ss",
  "st",
  "stada",
  "staples",
  "star",
  "statebank",
  "statefarm",
  "stc",
  "stcgroup",
  "stockholm",
  "storage",
  "store",
  "stream",
  "studio",
  "study",
  "style",
  "su",
  "sucks",
  "supplies",
  "supply",
  "support",
  "surf",
  "surgery",
  "suzuki",
  "sv",
  "swatch",
  "swiss",
  "sx",
  "sy",
  "sydney",
  "systems",
  "sz",
  "tab",
  "taipei",
  "talk",
  "taobao",
  "target",
  "tatamotors",
  "tatar",
  "tattoo",
  "tax",
  "taxi",
  "tc",
  "tci",
  "td",
  "tdk",
  "team",
  "tech",
  "technology",
  "tel",
  "temasek",
  "tennis",
  "teva",
  "tf",
  "tg",
  "th",
  "thd",
  "theater",
  "theatre",
  "tiaa",
  "tickets",
  "tienda",
  "tips",
  "tires",
  "tirol",
  "tj",
  "tjmaxx",
  "tjx",
  "tk",
  "tkmaxx",
  "tl",
  "tm",
  "tmall",
  "tn",
  "to",
  "today",
  "tokyo",
  "tools",
  "top",
  "toray",
  "toshiba",
  "total",
  "tours",
  "town",
  "toyota",
  "toys",
  "tr",
  "trade",
  "trading",
  "training",
  "travel",
  "travelers",
  "travelersinsurance",
  "trust",
  "trv",
  "tt",
  "tube",
  "tui",
  "tunes",
  "tushu",
  "tv",
  "tvs",
  "tw",
  "tz",
  "ua",
  "ubank",
  "ubs",
  "ug",
  "uk",
  "unicom",
  "university",
  "uno",
  "uol",
  "ups",
  "us",
  "uy",
  "uz",
  "va",
  "vacations",
  "vana",
  "vanguard",
  "vc",
  "ve",
  "vegas",
  "ventures",
  "verisign",
  "versicherung",
  "vet",
  "vg",
  "vi",
  "viajes",
  "video",
  "vig",
  "viking",
  "villas",
  "vin",
  "vip",
  "virgin",
  "visa",
  "vision",
  "viva",
  "vivo",
  "vlaanderen",
  "vn",
  "vodka",
  "volvo",
  "vote",
  "voting",
  "voto",
  "voyage",
  "vu",
  "wales",
  "walmart",
  "walter",
  "wang",
  "wanggou",
  "watch",
  "watches",
  "weather",
  "weatherchannel",
  "web",
  "webcam",
  "weber",
  "website",
  "wed",
  "wedding",
  "weibo",
  "weir",
  "wf",
  "whoswho",
  "wien",
  "wiki",
  "williamhill",
  "win",
  "windows",
  "wine",
  "winners",
  "wme",
  "woodside",
  "work",
  "works",
  "world",
  "wow",
  "ws",
  "wtc",
  "wtf",
  "xbox",
  "xerox",
  "xihuan",
  "xin",
  "xn--11b4c3d",
  "xn--1ck2e1b",
  "xn--1qqw23a",
  "xn--2scrj9c",
  "xn--30rr7y",
  "xn--3bst00m",
  "xn--3ds443g",
  "xn--3e0b707e",
  "xn--3hcrj9c",
  "xn--3pxu8k",
  "xn--42c2d9a",
  "xn--45br5cyl",
  "xn--45brj9c",
  "xn--45q11c",
  "xn--4dbrk0ce",
  "xn--4gbrim",
  "xn--54b7fta0cc",
  "xn--55qw42g",
  "xn--55qx5d",
  "xn--5su34j936bgsg",
  "xn--5tzm5g",
  "xn--6frz82g",
  "xn--6qq986b3xl",
  "xn--80adxhks",
  "xn--80ao21a",
  "xn--80aqecdr1a",
  "xn--80asehdb",
  "xn--80aswg",
  "xn--8y0a063a",
  "xn--90a3ac",
  "xn--90ae",
  "xn--90ais",
  "xn--9dbq2a",
  "xn--9et52u",
  "xn--9krt00a",
  "xn--b4w605ferd",
  "xn--bck1b9a5dre4c",
  "xn--c1avg",
  "xn--c2br7g",
  "xn--cck2b3b",
  "xn--cckwcxetd",
  "xn--cg4bki",
  "xn--clchc0ea0b2g2a9gcd",
  "xn--czr694b",
  "xn--czrs0t",
  "xn--czru2d",
  "xn--d1acj3b",
  "xn--d1alf",
  "xn--e1a4c",
  "xn--eckvdtc9d",
  "xn--efvy88h",
  "xn--fct429k",
  "xn--fhbei",
  "xn--fiq228c5hs",
  "xn--fiq64b",
  "xn--fiqs8s",
  "xn--fiqz9s",
  "xn--fjq720a",
  "xn--flw351e",
  "xn--fpcrj9c3d",
  "xn--fzc2c9e2c",
  "xn--fzys8d69uvgm",
  "xn--g2xx48c",
  "xn--gckr3f0f",
  "xn--gecrj9c",
  "xn--gk3at1e",
  "xn--h2breg3eve",
  "xn--h2brj9c",
  "xn--h2brj9c8c",
  "xn--hxt814e",
  "xn--i1b6b1a6a2e",
  "xn--imr513n",
  "xn--io0a7i",
  "xn--j1aef",
  "xn--j1amh",
  "xn--j6w193g",
  "xn--jlq480n2rg",
  "xn--jvr189m",
  "xn--kcrx77d1x4a",
  "xn--kprw13d",
  "xn--kpry57d",
  "xn--kput3i",
  "xn--l1acc",
  "xn--lgbbat1ad8j",
  "xn--mgb9awbf",
  "xn--mgba3a3ejt",
  "xn--mgba3a4f16a",
  "xn--mgba7c0bbn0a",
  "xn--mgbaam7a8h",
  "xn--mgbab2bd",
  "xn--mgbah1a3hjkrd",
  "xn--mgbai9azgqp6j",
  "xn--mgbayh7gpa",
  "xn--mgbbh1a",
  "xn--mgbbh1a71e",
  "xn--mgbc0a9azcg",
  "xn--mgbca7dzdo",
  "xn--mgbcpq6gpa1a",
  "xn--mgberp4a5d4ar",
  "xn--mgbgu82a",
  "xn--mgbi4ecexp",
  "xn--mgbpl2fh",
  "xn--mgbt3dhd",
  "xn--mgbtx2b",
  "xn--mgbx4cd0ab",
  "xn--mix891f",
  "xn--mk1bu44c",
  "xn--mxtq1m",
  "xn--ngbc5azd",
  "xn--ngbe9e0a",
  "xn--ngbrx",
  "xn--node",
  "xn--nqv7f",
  "xn--nqv7fs00ema",
  "xn--nyqy26a",
  "xn--o3cw4h",
  "xn--ogbpf8fl",
  "xn--otu796d",
  "xn--p1acf",
  "xn--p1ai",
  "xn--pgbs0dh",
  "xn--pssy2u",
  "xn--q7ce6a",
  "xn--q9jyb4c",
  "xn--qcka1pmc",
  "xn--qxa6a",
  "xn--qxam",
  "xn--rhqv96g",
  "xn--rovu88b",
  "xn--rvc1e0am3e",
  "xn--s9brj9c",
  "xn--ses554g",
  "xn--t60b56a",
  "xn--tckwe",
  "xn--tiq49xqyj",
  "xn--unup4y",
  "xn--vermgensberater-ctb",
  "xn--vermgensberatung-pwb",
  "xn--vhquv",
  "xn--vuq861b",
  "xn--w4r85el8fhu5dnra",
  "xn--w4rs40l",
  "xn--wgbh1c",
  "xn--wgbl6a",
  "xn--xhq521b",
  "xn--xkc2al3hye2a",
  "xn--xkc2dl3a5ee0h",
  "xn--y9a3aq",
  "xn--yfro4i67o",
  "xn--ygbi2ammx",
  "xn--zfr164b",
  "xxx",
  "xyz",
  "yachts",
  "yahoo",
  "yamaxun",
  "yandex",
  "ye",
  "yodobashi",
  "yoga",
  "yokohama",
  "you",
  "youtube",
  "yt",
  "yun",
  "za",
  "zappos",
  "zara",
  "zero",
  "zip",
  "zm",
  "zone",
  "zuerich",
  "zw"
];
var PROGRAMMING_COLLISION_TLDS = new Set([
  "actor",
  "email",
  "events",
  "fail",
  "health",
  "help",
  "id",
  "link",
  "map",
  "md",
  "name",
  "next",
  "post",
  "read",
  "sh",
  "shell",
  "tools",
  "watch"
]);
var RECOGNIZED_TLDS = new Set(IANA_TLDS.filter((tld) => !PROGRAMMING_COLLISION_TLDS.has(tld)));
function isRecognizedTld(label) {
  return RECOGNIZED_TLDS.has(label.toLowerCase());
}

// src/packed-artifact.ts
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
var MAX_ARCHIVE_MEMBER_BYTES = 5 * 1024 * 1024;
var MAX_SCANNED_MEMBER_BYTES = 512 * 1024 * 1024;
function isPackedArtifactPath(target) {
  return /\.(tgz|tar\.gz)$/i.test(target);
}
function extractArchive(target) {
  const directory = mkdtempSync(join(tmpdir(), "hasna-artifact-scan-"));
  try {
    execFileSync("tar", ["-xzf", resolve(target), "-C", directory], { stdio: "pipe" });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}
function listArchiveEntries(target) {
  return execFileSync("tar", ["-tzf", target], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).split(`
`).filter(Boolean);
}
function commonArchiveRoot(entries) {
  const firstSegments = new Set;
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
    if (!normalized || normalized.endsWith("/"))
      continue;
    const [first, ...rest] = normalized.split("/");
    if (!first || rest.length === 0)
      return null;
    firstSegments.add(first);
    if (firstSegments.size > 1)
      return null;
  }
  const [root] = [...firstSegments];
  return root ?? null;
}
function normalizeArchiveEntry(entry, commonRoot) {
  let normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/"))
    return null;
  if (commonRoot && (normalized === commonRoot || normalized.startsWith(`${commonRoot}/`))) {
    normalized = normalized.slice(commonRoot.length).replace(/^\/+/, "");
  } else {
    normalized = normalized.replace(/^package\//, "");
  }
  return normalized || null;
}
function readArchiveMemberText(target, entry) {
  return execFileSync("tar", ["-xOzf", target, entry], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_MEMBER_BYTES
  });
}

// src/artifact-scan.ts
var ASSET_INVENTORY_KINDS = ["domain", "host", "ip", "email"];
var DEFAULT_INVENTORY_THRESHOLDS = Object.freeze({
  domain: 20,
  host: 25,
  ip: 20,
  email: 15
});
var RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal", "onion", "arpa"]);
var RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org", "localhost"]);
var REGISTRY_SECOND_LEVELS = Object.freeze({
  uk: ["co", "org", "ac", "gov", "me", "net", "sch"],
  au: ["com", "net", "org", "edu", "gov"],
  nz: ["co", "net", "org"],
  jp: ["co", "or", "ne", "ac", "go"],
  br: ["com", "net", "org"],
  in: ["co", "net", "org"],
  cn: ["com", "net", "org", "gov"],
  za: ["co", "org"],
  kr: ["co", "or"],
  mx: ["com"],
  ar: ["com"],
  tr: ["com"],
  sg: ["com"],
  hk: ["com"],
  tw: ["com"]
});
var MULTI_LABEL_SUFFIXES = new Set(Object.entries(REGISTRY_SECOND_LEVELS).flatMap(([tld, seconds]) => seconds.map((second) => [second, tld].join("."))));
var QUOTED_LITERAL_PATTERN = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
var LITERAL_SEPARATORS = /[\s,;|]+/;
var FIELD_SEPARATORS = /[,|\t]/;
var MIN_COLUMN_RUN = 5;
var MIN_LITERAL_RUN = 5;
var LITERAL_RUN_GLUE = /^[\s,;:=|<>+\-\w$[\]{}]*$/;
var LABEL_LITERAL = /^[^.@\n]{1,80}$/;
var URL_AUTHORITY_PREFIX = /^(?:[a-z][a-z0-9+.-]*:)?\/\//;
var URL_AUTHORITY_END = /[/?#]/;
var HOST_PORT_SUFFIX = /:\d{1,5}$/;
var HOSTNAME_LITERAL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
var EMAIL_LITERAL = /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
var IPV4_LITERAL = /^(?:(?:0|[1-9]\d{0,2})\.){3}(?:0|[1-9]\d{0,2})$/;
var VERSION_KEY = /(?:^|[_.-])(?:v8|node|chrome|chromium|electron|engine|firefox|safari|opera|edge|ie|deno|bun|npm|yarn|pnpm|python|ruby|java|dotnet|semver|ver|version|revision|build|sdk|runtime|target|min|max)(?:[_.-]|$)/i;
function isVersionKey(key) {
  if (isCountableHostname(key.toLowerCase()))
    return false;
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return VERSION_KEY.test(normalized);
}
function enclosingKey(view, literalStart) {
  const before = view.slice(Math.max(0, literalStart - 96), literalStart);
  const match = /(?:"([^"\n]{1,64})"|'([^'\n]{1,64})'|([A-Za-z_$][\w$-]{0,63}))\s*:\s*$/.exec(before);
  return match ? match[1] ?? match[2] ?? match[3] ?? null : null;
}
var IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
function addressCandidates(view, codeLike) {
  const found = [];
  for (const match of view.matchAll(QUOTED_LITERAL_PATTERN)) {
    const literal = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!IPV4_LITERAL.test(literal))
      continue;
    if (codeLike) {
      const key = enclosingKey(view, match.index ?? 0);
      if (key !== null && isVersionKey(key))
        continue;
    }
    found.push(literal);
  }
  if (!codeLike) {
    for (const match of view.matchAll(IPV4_PATTERN)) {
      if (IPV4_LITERAL.test(match[0]))
        found.push(match[0]);
    }
  }
  return found;
}
function isReservedIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 168)
    return true;
  if (a === 192 && b === 0 && c === 2)
    return true;
  if (a === 198 && (b === 18 || b === 19))
    return true;
  if (a === 198 && b === 51 && c === 100)
    return true;
  if (a === 203 && b === 0 && c === 113)
    return true;
  return false;
}
function isReservedHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (RESERVED_DOMAINS.has(lower))
    return true;
  const tld = lower.slice(lower.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld))
    return true;
  return [...RESERVED_DOMAINS].some((reserved) => lower.endsWith(`.${reserved}`));
}
function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length <= 2)
    return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}
var MAX_INVENTORY_THRESHOLDS = Object.freeze({
  domain: 40,
  host: 50,
  ip: 40,
  email: 30
});
function clampThresholds(requested) {
  const clamped = { ...requested };
  for (const kind of ASSET_INVENTORY_KINDS) {
    const value = clamped[kind];
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`${kind} threshold must be a positive number.`);
    }
    if (value > MAX_INVENTORY_THRESHOLDS[kind]) {
      throw new Error(`${kind} threshold ${value} exceeds the ${MAX_INVENTORY_THRESHOLDS[kind]} ceiling. A threshold that high disables the detector, which is the gate being switched off through its own front door.`);
    }
  }
  return clamped;
}
function redact(entry, kind) {
  return `<${kind}:${reportDigest(entry)}>`;
}
var REPORT_SALT = randomBytes(16);
function reportDigest(value) {
  return createHash("sha256").update(REPORT_SALT).update(value, "utf8").digest("hex").slice(0, 8);
}
function decodeMember(bytes) {
  const utf8 = bytes.toString("utf8");
  return utf8.includes("\uFFFD") ? bytes.toString("latin1") : utf8;
}
function distinct(values) {
  return [...new Set(values)].sort();
}
function decodeEscapes(value) {
  const codePoint = (encoded, radix) => {
    const parsed = Number.parseInt(encoded, radix);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1114111)
      return null;
    return String.fromCodePoint(parsed);
  };
  const SIMPLE = {
    n: `
`,
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    "0": "\x00",
    '"': '"',
    "'": "'",
    "`": "`",
    "\\": "\\",
    "/": "/"
  };
  const decoded = value.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([\s\S])/gi, (match, braced, fourHex, twoHex, single) => {
    if (braced !== undefined)
      return codePoint(braced, 16) ?? match;
    if (fourHex !== undefined)
      return codePoint(fourHex, 16) ?? match;
    if (twoHex !== undefined)
      return codePoint(twoHex, 16) ?? match;
    return single !== undefined ? SIMPLE[single] ?? match : match;
  });
  return decoded.replace(/%([0-9a-f]{2})/gi, (match, hex) => codePoint(hex, 16) ?? match).replace(/&#x([0-9a-f]+);?/gi, (match, hex) => codePoint(hex, 16) ?? match).replace(/&#([0-9]+);?/g, (match, dec) => codePoint(dec, 10) ?? match);
}
function decodedViews(text) {
  const views = [text];
  const escaped = decodeEscapes(text);
  if (escaped !== text)
    views.push(escaped);
  const carriesAsset = /[a-z0-9]\.[a-z]/i;
  for (const match of text.matchAll(/[A-Za-z0-9+/]{64,}={0,2}/g)) {
    const token = match[0];
    if (token.length % 4 === 1)
      continue;
    const decoded = Buffer.from(token, "base64").toString("utf8");
    if (carriesAsset.test(decoded))
      views.push(decoded);
  }
  for (const match of text.matchAll(/\b[0-9a-f]{64,}\b/gi)) {
    const token = match[0].length % 2 === 0 ? match[0] : match[0].slice(0, -1);
    const decoded = Buffer.from(token, "hex").toString("utf8");
    if (carriesAsset.test(decoded))
      views.push(decoded);
  }
  return views;
}
function isCountableHostname(value) {
  if (!HOSTNAME_LITERAL.test(value))
    return false;
  if (isReservedHostname(value))
    return false;
  return isRecognizedTld(value.slice(value.lastIndexOf(".") + 1));
}
function isCountableEmail(value) {
  if (!EMAIL_LITERAL.test(value))
    return false;
  const domain = value.slice(value.indexOf("@") + 1);
  if (isReservedHostname(domain))
    return false;
  return isRecognizedTld(domain.slice(domain.lastIndexOf(".") + 1));
}
function hostComponent(piece) {
  const prefix = URL_AUTHORITY_PREFIX.exec(piece);
  if (!prefix)
    return piece.replace(HOST_PORT_SUFFIX, "").replace(/\.$/, "");
  let authority = piece.slice(prefix[0].length);
  const end = authority.search(URL_AUTHORITY_END);
  if (end >= 0)
    authority = authority.slice(0, end);
  const userinfo = authority.lastIndexOf("@");
  if (userinfo >= 0)
    authority = authority.slice(userinfo + 1);
  return authority.replace(HOST_PORT_SUFFIX, "").replace(/\.$/, "");
}
function countableAsset(piece) {
  const normalized = piece.toLowerCase();
  if (isCountableEmail(normalized))
    return normalized;
  const host = hostComponent(normalized);
  return isCountableHostname(host) ? host : null;
}
function record(asset, hosts, emails) {
  (isCountableEmail(asset) ? emails : hosts).add(asset);
}
var CODE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "mts",
  "cts",
  "json",
  "map",
  "css",
  "scss",
  "html",
  "vue",
  "svelte"
]);
function isCodeLikeMember(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0)
    return false;
  return CODE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
function isMemberAccessRun(run) {
  const twoLabel = run.filter((entry) => entry.asset.split(".").length === 2);
  if (twoLabel.length !== run.length)
    return false;
  const firstLabels = new Set(twoLabel.map((entry) => entry.asset.slice(0, entry.asset.indexOf("."))));
  if (firstLabels.size !== 1)
    return false;
  const tlds = new Set(twoLabel.map((entry) => entry.asset.slice(entry.asset.lastIndexOf(".") + 1)));
  return tlds.size === twoLabel.length;
}
function collectLineInventories(text, hosts, emails, codeLike) {
  let run = [];
  const closeRun = () => {
    if (run.length >= MIN_LITERAL_RUN && !(codeLike && isMemberAccessRun(run))) {
      for (const entry of run)
        record(entry.asset, hosts, emails);
    }
    run = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = rawLine.trim().replace(/^[-*+#>\s]+/, "").replace(/^\d+[.):,]?\s*/, "").replace(/^[A-Za-z0-9_-]{1,40}\s*:\s*/, "").trim();
    if (!stripped) {
      continue;
    }
    const line = stripped.replace(/^[\['"`(]+|[\]'"`),;]+$/g, "").trim();
    const asset = line ? countableAsset(line) : null;
    if (asset) {
      run.push({ asset });
      continue;
    }
    closeRun();
  }
  closeRun();
}
function collectDelimitedRun(text, hosts, emails) {
  const pieces = text.split(LITERAL_SEPARATORS).filter(Boolean);
  if (pieces.length < MIN_LITERAL_RUN)
    return;
  const assets = pieces.map(countableAsset);
  const countable = assets.filter((asset) => asset !== null);
  if (countable.length < MIN_LITERAL_RUN)
    return;
  if (countable.length * 2 < pieces.length)
    return;
  for (const asset of countable)
    record(asset, hosts, emails);
}
function collectLiteralInventories(text, hosts, emails, depth = 0) {
  let run = [];
  let previousEnd = -1;
  const closeRun = () => {
    if (run.length >= MIN_LITERAL_RUN)
      for (const asset of run)
        record(asset, hosts, emails);
    run = [];
  };
  for (const match of text.matchAll(QUOTED_LITERAL_PATTERN)) {
    const start = match.index ?? 0;
    const sibling = previousEnd >= 0 && LITERAL_RUN_GLUE.test(text.slice(previousEnd, start));
    previousEnd = start + match[0].length;
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const literal = raw.replace(/\\(["'`\\])/g, "$1").trim();
    if (depth < 2 && /["'`]/.test(literal)) {
      collectLiteralInventories(literal, hosts, emails, depth + 1);
    }
    const pieces = literal ? literal.split(LITERAL_SEPARATORS).map((piece) => piece.replace(/^[\[\]{}()"'`]+|[\[\]{}()"'`;,]+$/g, "")).filter(Boolean) : [];
    const assets = pieces.map(countableAsset).filter((asset) => asset !== null);
    const [first] = assets;
    if (!sibling)
      closeRun();
    if (first === undefined) {
      if (literal.length < 3)
        continue;
      if (IPV4_LITERAL.test(literal))
        continue;
      if (!LABEL_LITERAL.test(literal))
        closeRun();
      continue;
    }
    if (pieces.length === 1) {
      run.push(first);
      continue;
    }
    closeRun();
    if (assets.length * 2 >= pieces.length)
      for (const asset of assets)
        record(asset, hosts, emails);
  }
  closeRun();
}
function collectColumnInventories(text, hosts, emails) {
  const runs = new Map;
  const close = (column) => {
    const values = runs.get(column);
    runs.delete(column);
    if (!values || values.length < MIN_COLUMN_RUN)
      return;
    for (const value of values)
      record(value, hosts, emails);
  };
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(FIELD_SEPARATORS);
    const populated = fields.filter((field) => field.trim() !== "").length;
    const trimmed = line.trim();
    const carried = new Set;
    for (const [column, field] of fields.entries()) {
      const value = field.trim();
      const asset = countableAsset(value);
      if (asset === null)
        continue;
      if (populated < 2 && trimmed !== value)
        continue;
      carried.add(column);
      const run = runs.get(column);
      if (run)
        run.push(asset);
      else
        runs.set(column, [asset]);
    }
    for (const column of [...runs.keys()])
      if (!carried.has(column))
        close(column);
  }
  for (const column of [...runs.keys()])
    close(column);
}
function inventoryCounts(text, options = {}) {
  const codeLike = options.codeLike ?? true;
  const emails = new Set;
  const hosts = new Set;
  const views = decodedViews(text);
  for (const [index, view] of views.entries()) {
    collectLiteralInventories(view, hosts, emails);
    collectColumnInventories(view, hosts, emails);
    collectLineInventories(view, hosts, emails, codeLike && index === 0);
    if (index > 0)
      collectDelimitedRun(view, hosts, emails);
  }
  const emailHosts = new Set([...emails].map((email) => email.slice(email.indexOf("@") + 1)));
  const named = [...hosts].filter((host) => !emailHosts.has(host)).sort();
  const domains = distinct(named.map(registrableDomain));
  const hostList = named.filter((host) => host !== registrableDomain(host));
  const ips = distinct(views.flatMap((view) => addressCandidates(view, codeLike)).filter((ip) => !isReservedIpv4(ip)));
  return { domain: domains, host: hostList, ip: ips, email: [...emails].sort() };
}
function readError(error) {
  return error instanceof Error ? error.message : String(error);
}
function* readDirectoryMembers(root, maxMemberBytes, dir = root) {
  const skipDirs = new Set([".git", "node_modules"]);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join2(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name))
        yield* readDirectoryMembers(root, maxMemberBytes, full);
      continue;
    }
    if (!entry.isFile())
      continue;
    const path = relative(root, full).replaceAll("\\", "/");
    const size = statSync(full).size;
    if (size > maxMemberBytes) {
      yield { path, reason: `${size} bytes exceeds the ${maxMemberBytes}-byte scan ceiling` };
      continue;
    }
    try {
      yield { path, bytes: readFileSync(full) };
    } catch (error) {
      yield { path, reason: readError(error) };
    }
  }
}
function* readArchiveMembers(target, maxMemberBytes) {
  let extracted;
  try {
    extracted = extractArchive(target);
  } catch (error) {
    yield { path: basename(target), reason: `archive could not be extracted: ${readError(error)}` };
    return;
  }
  try {
    const root = existsSync(join2(extracted, "package")) ? join2(extracted, "package") : extracted;
    yield* readDirectoryMembers(root, maxMemberBytes);
  } finally {
    rmSync2(extracted, { recursive: true, force: true });
  }
}
function scanPublishedArtifact(target, options = {}) {
  const stat = statSync(target);
  const scanMode = stat.isDirectory() ? "source_tree" : isPackedArtifactPath(target) ? "packed_artifact" : "packed_artifact";
  if (!stat.isDirectory() && !isPackedArtifactPath(target)) {
    throw new Error("Artifact scan target must be a directory, .tgz, or .tar.gz file.");
  }
  const maxMemberBytes = options.maxMemberBytes ?? MAX_SCANNED_MEMBER_BYTES;
  const members = stat.isDirectory() ? readDirectoryMembers(target, maxMemberBytes) : readArchiveMembers(target, maxMemberBytes);
  const thresholds = clampThresholds({ ...DEFAULT_INVENTORY_THRESHOLDS, ...options.thresholds });
  const waived = new Set(options.waivedKinds ?? []);
  const ignore = new Set(options.ignorePaths ?? []);
  const findings = [];
  const waivedFindings = [];
  const aggregateFindings = [];
  const unreadable = [];
  const union = {
    domain: new Set,
    host: new Set,
    ip: new Set,
    email: new Set
  };
  let seen = 0;
  let scanned = 0;
  let excludedByCaller = 0;
  for (const member of members) {
    seen += 1;
    if (ignore.has(member.path)) {
      excludedByCaller += 1;
      continue;
    }
    if ("reason" in member) {
      unreadable.push({ path: member.path, reason: member.reason });
      continue;
    }
    scanned += 1;
    const counts = inventoryCounts(decodeMember(member.bytes), {
      codeLike: isCodeLikeMember(member.path)
    });
    for (const kind of ASSET_INVENTORY_KINDS) {
      const entries = counts[kind];
      for (const entry of entries)
        union[kind].add(entry);
      const threshold = thresholds[kind];
      if (entries.length < threshold)
        continue;
      const finding = {
        path: member.path,
        kind,
        count: entries.length,
        threshold,
        sample: entries.slice(0, 3).map((entry) => redact(entry, kind))
      };
      (waived.has(kind) ? waivedFindings : findings).push(finding);
    }
  }
  for (const kind of ASSET_INVENTORY_KINDS) {
    const entries = [...union[kind]].sort();
    const threshold = thresholds[kind];
    if (entries.length < threshold)
      continue;
    if (findings.some((finding2) => finding2.kind === kind))
      continue;
    if (waivedFindings.some((finding2) => finding2.kind === kind))
      continue;
    const finding = {
      path: "<artifact>",
      kind,
      count: entries.length,
      threshold,
      sample: entries.slice(0, 3).map((entry) => redact(entry, kind))
    };
    aggregateFindings.push(finding);
    (waived.has(kind) ? waivedFindings : findings).push(finding);
  }
  if (scanned === 0) {
    throw new Error(`Artifact scan read zero members from ${basename(target)} (${seen} seen, ${excludedByCaller} excluded). Refusing to report a clean verdict on nothing.`);
  }
  return {
    ok: findings.length === 0 && unreadable.length === 0,
    target,
    scanMode,
    membersScanned: scanned,
    membersSkipped: excludedByCaller,
    findings,
    aggregateFindings,
    waived: waivedFindings,
    unreadable
  };
}
function formatArtifactScanReport(report) {
  const lines = [
    `${report.ok ? "pass" : "FAIL"} artifact-scan ${basename(report.target)} (${report.scanMode}, ${report.membersScanned} members scanned, ${report.membersSkipped} excluded, ${report.unreadable.length} unreadable)`
  ];
  for (const finding of report.findings) {
    lines.push(`  FAIL ${finding.path}: ${finding.count} distinct ${finding.kind} entries (threshold ${finding.threshold}) e.g. ${finding.sample.join(", ")}`);
  }
  for (const member of report.unreadable) {
    lines.push(`  FAIL ${member.path}: could not be read, so it has not been cleared (${member.reason})`);
  }
  for (const finding of report.waived) {
    lines.push(`  waived ${finding.path}: ${finding.count} distinct ${finding.kind} entries`);
  }
  return lines.join(`
`);
}
function isAssetInventoryKind(value) {
  return typeof value === "string" && ASSET_INVENTORY_KINDS.includes(value);
}
function readDeclaredWaiver(value) {
  if (typeof value !== "object" || value === null)
    return "waiver entry is not an object";
  const declared = value;
  const { kind, reason, reviewedBy, expiresAt } = declared;
  if (!isAssetInventoryKind(kind)) {
    return `waiver kind ${JSON.stringify(kind)} is not one of ${ASSET_INVENTORY_KINDS.join(", ")}`;
  }
  if (typeof reason !== "string" || reason.trim() === "")
    return `waiver for ${kind} names no reason`;
  if (typeof reviewedBy !== "string" || reviewedBy.trim() === "")
    return `waiver for ${kind} names no reviewer`;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt)))
    return `waiver for ${kind} has no usable expiresAt`;
  return { kind, reason, reviewedBy, expiresAt };
}
function resolveAssetInventoryWaivers(manifestPath, now = new Date) {
  if (!existsSync(manifestPath))
    return { kinds: [], notes: [] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read asset-inventory waivers from ${manifestPath}: ${readError(error)}`);
  }
  const conformance = manifest?.metadata?.conformance;
  const declared = conformance?.waivedAssetInventories;
  if (declared === undefined)
    return { kinds: [], notes: [] };
  if (!Array.isArray(declared)) {
    return { kinds: [], notes: ["metadata.conformance.waivedAssetInventories is not an array; no waiver applied"] };
  }
  const kinds = [];
  const notes = [];
  for (const entry of declared) {
    const waiver = readDeclaredWaiver(entry);
    if (typeof waiver === "string") {
      notes.push(`${waiver}; not applied`);
      continue;
    }
    if (Date.parse(waiver.expiresAt) <= now.getTime()) {
      notes.push(`${waiver.kind} waiver expired at ${waiver.expiresAt}; not applied`);
      continue;
    }
    if (!kinds.includes(waiver.kind))
      kinds.push(waiver.kind);
    notes.push(`${waiver.kind} waived until ${waiver.expiresAt} (reviewed by ${waiver.reviewedBy}): ${waiver.reason}`);
  }
  return { kinds, notes };
}
export {
  scanPublishedArtifact,
  resolveAssetInventoryWaivers,
  registrableDomain,
  redact,
  isReservedIpv4,
  isReservedHostname,
  isCodeLikeMember,
  inventoryCounts,
  formatArtifactScanReport,
  decodeEscapes,
  MAX_INVENTORY_THRESHOLDS,
  DEFAULT_INVENTORY_THRESHOLDS,
  ASSET_INVENTORY_KINDS
};
