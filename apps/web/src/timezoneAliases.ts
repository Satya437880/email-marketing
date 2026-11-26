// Time zone names browsers accept but leave out of their own list (older and alternative IANA names, plus the fixed Etc/GMT offsets).
// The picker keeps only the ones the current browser understands.
export const EXTRA_ZONES: string[] = [
  "UTC", "GMT", "Greenwich", "Universal", "Zulu", "UCT", "Etc/UTC", "Etc/GMT",
  "Asia/Kolkata", "Asia/Calcutta", "Asia/Kathmandu", "Asia/Katmandu", "Asia/Yangon", "Asia/Rangoon", "Asia/Ho_Chi_Minh", "Asia/Saigon",
  "Asia/Dacca", "Asia/Thimbu", "Asia/Ulan_Bator", "Asia/Ashkhabad", "Asia/Macao", "Asia/Istanbul", "Asia/Tel_Aviv", "Asia/Ujung_Pandang",
  "Asia/Chongqing", "Asia/Chungking", "Asia/Harbin", "Asia/Kashgar",
  "Africa/Asmera", "Africa/Timbuktu",
  "America/Argentina/Buenos_Aires", "America/Argentina/Catamarca", "America/Argentina/Cordoba", "America/Argentina/Jujuy", "America/Argentina/Mendoza",
  "America/Buenos_Aires", "America/Catamarca", "America/Cordoba", "America/Indianapolis", "America/Jujuy", "America/Louisville", "America/Mendoza",
  "America/Montreal", "America/Nuuk", "America/Santa_Isabel", "America/Shiprock", "America/Virgin",
  "Antarctica/South_Pole", "Atlantic/Faeroe", "Atlantic/Jan_Mayen",
  "Australia/ACT", "Australia/Canberra", "Australia/LHI", "Australia/NSW", "Australia/North", "Australia/Queensland", "Australia/South",
  "Australia/Tasmania", "Australia/Victoria", "Australia/West", "Australia/Yancowinna",
  "Brazil/Acre", "Brazil/DeNoronha", "Brazil/East", "Brazil/West",
  "Canada/Atlantic", "Canada/Central", "Canada/Eastern", "Canada/Mountain", "Canada/Newfoundland", "Canada/Pacific", "Canada/Saskatchewan", "Canada/Yukon",
  "Chile/Continental", "Chile/EasterIsland", "Mexico/BajaNorte", "Mexico/BajaSur", "Mexico/General",
  "Europe/Belfast", "Europe/Kiev", "Europe/Kyiv", "Europe/Nicosia", "Europe/Tiraspol", "Europe/Uzhgorod", "Europe/Zaporozhye",
  "Pacific/Enderbury", "Pacific/Kanton", "Pacific/Ponape", "Pacific/Samoa", "Pacific/Truk", "Pacific/Yap",
  "US/Alaska", "US/Aleutian", "US/Arizona", "US/Central", "US/East-Indiana", "US/Eastern", "US/Hawaii", "US/Indiana-Starke", "US/Michigan", "US/Mountain", "US/Pacific", "US/Samoa",
  "Cuba", "Egypt", "Eire", "GB", "GB-Eire", "Hongkong", "Iceland", "Iran", "Israel", "Jamaica", "Japan", "Kwajalein", "Libya", "Navajo", "NZ", "NZ-CHAT", "PRC",
  "Poland", "Portugal", "ROC", "ROK", "Singapore", "Turkey", "W-SU",
  "EST", "MST", "HST", "EST5EDT", "CST6CDT", "MST7MDT", "PST8PDT", "CET", "EET", "MET", "WET",
  "Etc/GMT+1", "Etc/GMT+2", "Etc/GMT+3", "Etc/GMT+4", "Etc/GMT+5", "Etc/GMT+6", "Etc/GMT+7", "Etc/GMT+8", "Etc/GMT+9", "Etc/GMT+10", "Etc/GMT+11", "Etc/GMT+12",
  "Etc/GMT-1", "Etc/GMT-2", "Etc/GMT-3", "Etc/GMT-4", "Etc/GMT-5", "Etc/GMT-6", "Etc/GMT-7", "Etc/GMT-8", "Etc/GMT-9", "Etc/GMT-10", "Etc/GMT-11", "Etc/GMT-12", "Etc/GMT-13", "Etc/GMT-14",
];

// Abbreviations shown on the right of a zone in the picker, with the country, and searchable (EST, PST, "Canada", "United States" ...).
// United States and Canada zones are tagged automatically in TimezoneSelect from ianaZones.ts; the ones listed here are everywhere else.
// Each zone is a real city zone, so daylight saving is handled automatically (America/New_York is EST in winter and EDT in summer).
export interface ZoneTag { tz: string; abbr: string; region: string; words?: string }
export const ZONE_TAGS: ZoneTag[] = [
  // India and others
  { tz: "Asia/Kolkata", abbr: "IST", region: "India", words: "Indian" },
  { tz: "Asia/Calcutta", abbr: "IST", region: "India", words: "Indian" },
  { tz: "Europe/London", abbr: "GMT", region: "United Kingdom", words: "BST British UK" },
  { tz: "Europe/Paris", abbr: "CET", region: "France", words: "CEST Central European" },
  { tz: "Europe/Berlin", abbr: "CET", region: "Germany", words: "CEST Central European" },
  { tz: "Europe/Athens", abbr: "EET", region: "Greece", words: "EEST Eastern European" },
  { tz: "Europe/Moscow", abbr: "MSK", region: "Russia" },
  { tz: "Asia/Dubai", abbr: "GST", region: "United Arab Emirates", words: "Gulf UAE" },
  { tz: "Asia/Karachi", abbr: "PKT", region: "Pakistan" },
  { tz: "Asia/Singapore", abbr: "SGT", region: "Singapore" },
  { tz: "Asia/Hong_Kong", abbr: "HKT", region: "Hong Kong" },
  { tz: "Asia/Tokyo", abbr: "JST", region: "Japan" },
  { tz: "Asia/Seoul", abbr: "KST", region: "South Korea" },
  { tz: "Australia/Perth", abbr: "AWST", region: "Australia" },
  { tz: "Australia/Adelaide", abbr: "ACST", region: "Australia", words: "ACDT" },
  { tz: "Australia/Sydney", abbr: "AEST", region: "Australia", words: "AEDT" },
  { tz: "Pacific/Auckland", abbr: "NZST", region: "New Zealand", words: "NZDT" },
  { tz: "Africa/Johannesburg", abbr: "SAST", region: "South Africa" },
  { tz: "Africa/Lagos", abbr: "WAT", region: "Nigeria" },
  { tz: "Africa/Nairobi", abbr: "EAT", region: "Kenya" },
];

// US and Canadian zones take their abbreviation from the standard (winter) offset: -5 is EST, -8 is PST and so on.
export const NA_ABBR: Record<string, { abbr: string; words: string }> = {
  "GMT-3:30": { abbr: "NST", words: "NDT Newfoundland" },
  "GMT-4": { abbr: "AST", words: "ADT Atlantic" },
  "GMT-5": { abbr: "EST", words: "EDT ET Eastern" },
  "GMT-6": { abbr: "CST", words: "CDT CT Central" },
  "GMT-7": { abbr: "MST", words: "MDT MT Mountain" },
  "GMT-8": { abbr: "PST", words: "PDT PT Pacific" },
  "GMT-9": { abbr: "AKST", words: "AKDT Alaska" },
  "GMT-10": { abbr: "HST", words: "Hawaii Aleutian" },
};
