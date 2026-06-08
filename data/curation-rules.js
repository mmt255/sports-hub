// Football: API-Sports team IDs
const FOOTBALL_TEAMS = {
  manchester_united: { id: 33,  name: 'Manchester United', priority: 'highest' },
  manchester_city:   { id: 50,  name: 'Manchester City' },
  arsenal:           { id: 42,  name: 'Arsenal' },
  liverpool:         { id: 40,  name: 'Liverpool' },
  chelsea:           { id: 49,  name: 'Chelsea' },
  real_madrid:       { id: 541, name: 'Real Madrid' },
  barcelona:         { id: 529, name: 'Barcelona' },
  bayern_munich:     { id: 157, name: 'Bayern München' },
  inter_milan:       { id: 505, name: 'Inter Milan' },
  ac_milan:          { id: 489, name: 'AC Milan' },
  juventus:          { id: 496, name: 'Juventus' },
  napoli:            { id: 492, name: 'Napoli' },
  psg:               { id: 85,  name: 'Paris Saint-Germain' },
}

const FOOTBALL_TEAM_IDS = new Set(Object.values(FOOTBALL_TEAMS).map(t => t.id))

const FOOTBALL_TEAM_NAMES_LOWER = new Set(
  Object.values(FOOTBALL_TEAMS).map(t => t.name.toLowerCase())
)
// Common aliases used by API-Sports
const FOOTBALL_TEAM_ALIASES = {
  'paris saint-germain': 'psg',
  'paris sg': 'psg',
  'psg': 'psg',
  'man united': 'manchester_united',
  'man. united': 'manchester_united',
  'manchester utd': 'manchester_united',
  'man city': 'manchester_city',
  'man. city': 'manchester_city',
  'fc barcelona': 'barcelona',
  'barca': 'barcelona',
  'real cf': 'real_madrid',
  'fc bayern münchen': 'bayern_munich',
  'bayern munich': 'bayern_munich',
  'fc internazionale': 'inter_milan',
  'inter': 'inter_milan',
  'internazionale': 'inter_milan',
  'ac milan': 'ac_milan',
  'milan': 'ac_milan',
  'ssc napoli': 'napoli',
  'juventus fc': 'juventus',
  'juve': 'juventus',
}

// Football: API-Sports league IDs
const FOOTBALL_LEAGUES = {
  champions_league:       2,
  europa_league:          3,
  conference_league:      848,
  premier_league:         39,
  fa_cup:                 45,
  community_shield:       528,
  la_liga:                140,
  copa_del_rey:           143,
  serie_a:                135,
  coppa_italia:           137,
  bundesliga:             78,
  dfb_pokal:              81,
  ligue_1:                61,
  coupe_de_france:        65,
  world_cup:              1,
  int_friendlies:         10,
  club_world_cup:         15,
  uefa_super_cup:         531,
}

// These leagues: include ALL rounds (team filter still applies to non-final rounds)
const OPEN_LEAGUES = new Set([
  FOOTBALL_LEAGUES.champions_league,
  FOOTBALL_LEAGUES.europa_league,
  FOOTBALL_LEAGUES.conference_league,
  FOOTBALL_LEAGUES.premier_league,
  FOOTBALL_LEAGUES.la_liga,
  FOOTBALL_LEAGUES.serie_a,
  FOOTBALL_LEAGUES.bundesliga,
  FOOTBALL_LEAGUES.ligue_1,
  FOOTBALL_LEAGUES.world_cup,
  FOOTBALL_LEAGUES.int_friendlies,
  FOOTBALL_LEAGUES.club_world_cup,
  FOOTBALL_LEAGUES.community_shield,
  FOOTBALL_LEAGUES.uefa_super_cup,
])

// These cup leagues: only include finals (unless a curated club is playing)
const CUP_LEAGUES = new Set([
  FOOTBALL_LEAGUES.fa_cup,
  FOOTBALL_LEAGUES.copa_del_rey,
  FOOTBALL_LEAGUES.coppa_italia,
  FOOTBALL_LEAGUES.dfb_pokal,
  FOOTBALL_LEAGUES.coupe_de_france,
])

// All leagues to fetch (open + cup)
const ALL_FOOTBALL_LEAGUES = [
  ...OPEN_LEAGUES,
  ...CUP_LEAGUES,
]

// Top-20 FIFA nations for friendly filtering
const TOP_FIFA_NATIONS = new Set([
  'argentina', 'france', 'england', 'belgium', 'brazil', 'portugal',
  'netherlands', 'spain', 'germany', 'croatia', 'italy', 'morocco',
  'colombia', 'usa', 'united states', 'uruguay', 'japan', 'senegal',
  'denmark', 'mexico', 'switzerland', 'australia', 'south korea',
  'ecuador', 'austria', 'ukraine',
])

// NBA: playoff/finals identifiers (matched against API game stage/type fields)
const NBA_PLAYOFF_KEYWORDS = ['playoff', 'finals', 'all-star', 'play-in', 'conference']

// UFC: only numbered events
const UFC_NUMBERED_RE = /^UFC\s+\d+/i

module.exports = {
  FOOTBALL_TEAMS,
  FOOTBALL_TEAM_IDS,
  FOOTBALL_TEAM_NAMES_LOWER,
  FOOTBALL_TEAM_ALIASES,
  FOOTBALL_LEAGUES,
  OPEN_LEAGUES,
  CUP_LEAGUES,
  ALL_FOOTBALL_LEAGUES,
  TOP_FIFA_NATIONS,
  NBA_PLAYOFF_KEYWORDS,
  UFC_NUMBERED_RE,
}
