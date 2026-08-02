/**
 * Every word the site says, in both languages.
 *
 * Hebrew is the default — this is a living room in Israel — but English stays
 * one tap away in the options menu, because half the family's phones are set to
 * it and a room code is no use to someone who can't find the join button.
 *
 * No i18n library and no template parser. Keys that need values are plain
 * functions, which means `tsc` checks their arity as well as their existence:
 * `en` is typed as `typeof he`, so a missing key or a formatter that forgot an
 * argument is a build error rather than a blank label somebody notices in
 * production. `npm run typecheck` is the guard that the two stay in step.
 *
 * Strings that belong to the room rather than to the UI — seat colours, game
 * metadata, server error text — deliberately live here too rather than in
 * `@mg/shared`. The server has no UI and its logs should stay readable, so it
 * keeps its English and the client looks up a translation by id or error code.
 */
import type { ErrorCode, GameId } from '@mg/shared';

export type Lang = 'he' | 'en';

const he = {
  // -------------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------------
  tagline: 'משחקי כורסא עם כל המשפחה',
  yourName: 'השם שלך',
  namePlaceholder: 'מי אתם?',
  yourColour: 'הצבע שלך',
  yourLook: 'המראה שלך',
  yourHat: 'הכובע שלך',
  yourFace: 'הפרצוף שלך',
  startRoom: 'פתחו חדר',
  joinWithCode: 'הצטרפו עם קוד',
  roomCode: 'קוד החדר',
  joinRoom: 'הצטרפו לחדר',
  back: 'חזרה',
  gamesHeading: 'מה משחקים עכשיו',
  reviewsHeading: 'מה אומרים עלינו',

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------
  copyInvite: 'העתקת הזמנה',
  copied: 'הועתק!',
  copyThisLink: 'העתיקו את הקישור:',
  whosHere: 'מי כאן',
  outOf: (n: number, max: number) => `(${n}/${max})`,
  suffixYou: ' (זה אתם)',
  metaHost: 'מארח · ',
  metaAway: 'לא מחובר',
  metaReady: 'מוכן',
  metaNotReady: 'לא מוכן',
  ready: 'אני מוכן',
  notReady: 'רגע, אני לא מוכן',
  startGame: (game: string) => `התחילו ${game}`,
  needReady: (min: number) => `צריך ${min} שחקנים מוכנים`,
  leave: 'יציאה',
  pickAGame: 'בחרו משחק',
  hostIsPicking: 'המארח בוחר משחק',
  gameSettings: (game: string) => `הגדרות ${game}`,
  // A Hebrew one-letter prefix takes a hyphen before a Latin word — "ל-Gun
  // Mayhem", never "לGun Mayhem" — and the game names are Latin in both
  // languages.
  readyCount: (n: number, min: number, game: string) =>
    n === 1
      ? `שחקן אחד מוכן — ל-${game} צריך לפחות ${min}.`
      : `${n} מוכנים — ל-${game} צריך לפחות ${min}.`,
  overflow: (game: string, max: number, n: number) =>
    n === 1
      ? `ב-${game} יש ${max} מקומות. אחד צופה במשחק הזה ונכנס בבא.`
      : `ב-${game} יש ${max} מקומות. ${n} צופים במשחק הזה ונכנסים בבא.`,

  // -------------------------------------------------------------------------
  // In a match
  // -------------------------------------------------------------------------
  round: (n: number) => `סיבוב ${n}`,
  roundOver: 'הסיבוב נגמר',
  watching: 'צופים',
  watchingHost: 'אין לכם מקום במשחק הזה — «התחלת משחק מחדש» בתפריט תכניס אתכם.',
  watchingGuest:
    'אין לכם מקום במשחק הזה. המארח יכול להכניס אתכם עם «התחלת משחק מחדש», או שתיכנסו בבא.',
  paused: 'מושהה',
  pausedBy: (name: string) => `${name} עצר את המשחק`,
  pausedByNobody: 'המשחק עצור',
  resume: 'המשיכו',
  waitingForPlayer: 'מחכים שמישהו ימשיך…',
  matchOver: 'המשחק נגמר',
  winner: (name: string) => `${name} ניצח`,
  nobodyWins: 'אף אחד לא ניצח',
  backToLobby: 'חזרה ללובי',
  waitingForHost: 'מחכים למארח…',
  leaveRoom: 'צאו מהחדר',
  netTitle: (rtt: number, jitter: number, delay: number) =>
    `פינג ${rtt} מ״ש · ריצוד ${jitter} מ״ש · האחרים מצוירים ${delay} מ״ש אחורה`,
  livesLeft: (n: number) => `נשארו ${n} חיים`,
  rotateHint: 'סובבו את הטלפון לרוחב',
  enterFullscreen: 'מסך מלא',
  exitFullscreen: 'צאו ממסך מלא',
  /** iPhone only: Safari cannot hide its own bars, so this is the way out. */
  fullscreenInstallHint: 'ב־iPhone: שתפו ← «הוסף למסך הבית», ופתחו משם למסך מלא.',

  // Touch controls. Short on purpose — they are printed inside the buttons.
  padFire: 'ירי',
  padBomb: 'פצצה',

  // Voice chat
  voiceHeading: 'צ׳אט קולי',
  voiceJoin: 'הפעילו מיקרופון',
  voiceMute: 'השתיקו אותי',
  voiceUnmute: 'בטלו השתקה',
  voiceLeave: 'כבו מיקרופון',
  voiceDenied: 'הדפדפן חסם את המיקרופון. אשרו גישה בהגדרות האתר ונסו שוב.',
  voiceNoDevice: 'לא נמצא מיקרופון במכשיר הזה.',
  voiceUnsupported: 'הדפדפן הזה לא תומך בשיחות קוליות.',
  voiceConnecting: 'מתחברים…',
  voiceConnected: 'מחובר',
  /** Per-person, next to a name. `voiceFailed` is the room-wide summary. */
  voicePeerFailed: 'אין חיבור',
  voiceIosNote: 'באייפון: בדקו שהטלפון לא על שקט (המתג בצד), שהווליום מוגבר, ושהרשיתם לספארי להשתמש במיקרופון.',
  voiceFailed: (n: number) =>
    n === 1
      ? 'אין חיבור קולי לשחקן אחד — קורה בעיקר ברשת סלולרית.'
      : `אין חיבור קולי ל-${n} שחקנים — קורה בעיקר ברשת סלולרית.`,

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------
  options: 'הגדרות',
  optionsHint: 'הגדרות (Esc)',
  close: 'סגירה',
  sectionSound: 'סאונד',
  soundEffects: 'אפקטים',
  musicLabel: 'מוזיקה',
  musicVolume: 'עוצמת המוזיקה',
  sectionControls: 'שליטה',
  onScreenControls: 'כפתורים על המסך',
  touchAuto: 'אוטומטי',
  touchOn: 'תמיד',
  touchOff: 'אף פעם',
  touchHelpAutoTouch: 'אוטומטי: המכשיר נראה כמו מסך מגע, אז הכפתורים מוצגים.',
  touchHelpAutoNone:
    'אוטומטי: לא זוהה מסך מגע. הדליקו «תמיד» אם אתם בטלפון ולא רואים את הכפתורים.',
  touchHelpOn: 'מוצגים תמיד, בלי קשר למה שהדפדפן מדווח על המכשיר.',
  touchHelpOff: 'לא מוצגים אף פעם. מקלדת בלבד.',
  sectionLanguage: 'שפה',
  langHebrew: 'עברית',
  langEnglish: 'English',
  sectionMatch: 'המשחק',
  pauseForEveryone: 'השהו לכולם',
  onlyPlayersPause: 'רק מי שמשחק יכול להשהות.',
  restartMatch: 'התחלת משחק מחדש',
  endMatch: 'סיימו את המשחק',
  onlyHostRestart: 'רק המארח יכול להתחיל מחדש או לסיים.',
  controlsFor: (game: string) => `${game} — שליטה`,
  howToPlay: 'איך משחקים',
  backToGame: 'חזרה למשחק',

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------
  chooseAGame: 'בחרו משחק',
  playersRange: (min: number, max: number) => `${min}–${max} שחקנים`,
  playingThis: 'משחקים את זה',

  // Game names stay as they are — they are proper nouns in both languages.
  games: {
    achtung: {
      tagline: 'ציירו קו. אל תיגעו בכלום.',
      controls: 'חצים ימינה ושמאלה, או A ו-D',
      rules: [
        'העקומה שלכם מתקדמת לבד, בלי הפסקה. אתם רק פונים ימינה ושמאלה.',
        'נגיעה בכל קו — כולל שלכם — או בקיר, הורגת אתכם.',
        'כל עקומה מפסיקה לצייר מדי פעם ומשאירה חור. זו הדרך היחידה לעבור.',
        'אתם מקבלים נקודה על כל שחקן שמת לפניכם.',
        'הראשון שמגיע לניקוד היעד מנצח.',
      ],
    },
    gunmayhem: {
      tagline: 'תפילו את החברים מהבמה.',
      controls: 'חצים או WASD לתזוזה · למעלה לקפיצה · למטה לצניחה · J ירי · K פצצה',
      rules: [
        'תפילו את כולם מהבמה. נפילה עולה לכם חיים.',
        'הנזק נצבר ככל שיורים בכם — ככל שהוא גבוה יותר, כך המכה הבאה תעיף אתכם רחוק יותר.',
        'יש לכם שתי קפיצות. אפשר לקפוץ דרך משטחים דקים מלמטה, או לצנוח דרכם עם למטה.',
        'ארגזים מפילים נשקים חדשים. התחמושת מוגבלת, ואז חוזרים לאקדח.',
        'מי שמוצא סכין יכול לדקור ממש מקרוב — זה מכה חזק ומזנק קדימה.',
        'שדרוגים מרחפים מעל המשטחים: מהירות, מזנק, קפיצה משולשת, מגן, היעלמות ועוד.',
        'מי שנגמרו לו החיים יוצא. האחרון ששורד מנצח בסיבוב.',
      ],
    },
  } satisfies Record<GameId, { tagline: string; controls: string; rules: string[] }>,

  // -------------------------------------------------------------------------
  // Settings panels
  // -------------------------------------------------------------------------
  setPowerups: 'שדרוגים',
  setWinByTwo: 'ניצחון בהפרש שתיים',
  setSpeed: 'מהירות',
  speedLabels: ['רגוע', 'רגיל', 'מהיר'],
  setPlayTo: 'משחקים עד',
  suggestedFor: (players: number, score: number) =>
    `מומלץ ל-${players} ${players === 1 ? 'שחקן' : 'שחקנים'}: ${score}`,
  setStage: 'במה',
  stageRandom: 'אקראי',
  stageNames: ['הסלון', 'גגות', 'מגדלים'],
  setWeaponCrates: 'ארגזי נשק',
  setBombs: 'פצצות',
  setLivesEach: 'חיים לכל אחד',
  setRoundsToWin: 'סיבובים לניצחון',

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------
  colorNames: ['אדום', 'ירוק', 'כחול', 'צהוב', 'כתום', 'סגול', 'תכלת', 'ורוד'],
  colorTaken: (name: string) => `${name} — תפוס`,
  hatNames: ['בלי כובע', 'קסקט', 'כתר', 'מגבעת', 'קרניים', 'סרט', 'הילה', 'גרבון'],
  faceNames: ['רגיל', 'שמח', 'כועס', 'משקפיים', 'מסוחרר', 'ציקלופ'],

  // -------------------------------------------------------------------------
  // Errors and connection
  // -------------------------------------------------------------------------
  lostConnection: 'נותק החיבור — מנסים שוב…',
  dismiss: 'סגירה',
  errors: {
    BAD_MESSAGE: 'משהו השתבש בהודעה. נסו לרענן את הדף.',
    BAD_VERSION: 'הדף הזה ישן. רעננו כדי לקבל את הגרסה החדשה.',
    NO_SUCH_ROOM: 'אין חדר עם הקוד הזה. בדקו את הקוד ונסו שוב.',
    ROOM_FULL: 'החדר מלא.',
    COLOR_TAKEN: 'הצבע הזה כבר תפוס. בחרו אחר.',
    NOT_HOST: 'רק המארח יכול לעשות את זה.',
    NOT_IN_ROOM: 'רק מי שמשחק יכול לעשות את זה.',
    ALREADY_STARTED: 'המשחק כבר התחיל.',
    NOT_ENOUGH_PLAYERS: 'אין מספיק שחקנים מוכנים.',
    RESUME_FAILED: 'המקום שלכם כבר לא שמור. הצטרפו מחדש.',
    RATE_LIMITED: 'רגע, לאט יותר.',
  } satisfies Record<ErrorCode, string>,
};

export type Dict = typeof he;

const en: Dict = {
  tagline: 'Couch games for the whole family',
  yourName: 'Your name',
  namePlaceholder: 'who are you?',
  yourColour: 'Your colour',
  yourLook: 'Your look',
  yourHat: 'Your hat',
  yourFace: 'Your face',
  startRoom: 'Start a room',
  joinWithCode: 'Join with a code',
  roomCode: 'Room code',
  joinRoom: 'Join room',
  back: 'Back',
  gamesHeading: 'In the room right now',
  reviewsHeading: 'What people are saying',

  copyInvite: 'Copy invite',
  copied: 'Copied!',
  copyThisLink: 'Copy this link:',
  whosHere: "Who's here",
  outOf: (n: number, max: number) => `(${n}/${max})`,
  suffixYou: ' (you)',
  metaHost: 'host · ',
  metaAway: 'away',
  metaReady: 'ready',
  metaNotReady: 'not ready',
  ready: "I'm ready",
  notReady: "Wait, I'm not ready",
  startGame: (game: string) => `Start ${game}`,
  needReady: (min: number) => `Need ${min} ready players`,
  leave: 'Leave',
  pickAGame: 'Pick a game',
  hostIsPicking: 'The host is picking',
  gameSettings: (game: string) => `${game} settings`,
  readyCount: (n: number, min: number, game: string) =>
    n === 1
      ? `1 ready — ${game} needs at least ${min}.`
      : `${n} ready — ${game} needs at least ${min}.`,
  overflow: (game: string, max: number, n: number) =>
    n === 1
      ? `${game} seats ${max}. 1 person watches this match and rotates in next.`
      : `${game} seats ${max}. ${n} people watch this match and rotate in next.`,

  round: (n: number) => `Round ${n}`,
  roundOver: 'Round over',
  watching: 'Watching',
  watchingHost: 'You have no seat in this match — “Restart match” in the menu deals you in.',
  watchingGuest:
    'You have no seat in this match. The host can deal you in with “Restart match”, or you’re in the next one.',
  paused: 'Paused',
  pausedBy: (name: string) => `${name} stopped the game`,
  pausedByNobody: 'The game is stopped',
  resume: 'Resume',
  waitingForPlayer: 'Waiting for a player to resume…',
  matchOver: 'Match over',
  winner: (name: string) => `${name} wins`,
  nobodyWins: 'Nobody wins',
  backToLobby: 'Back to the lobby',
  waitingForHost: 'Waiting for the host…',
  leaveRoom: 'Leave room',
  netTitle: (rtt: number, jitter: number, delay: number) =>
    `Ping ${rtt}ms · jitter ${jitter}ms · others drawn ${delay}ms behind`,
  livesLeft: (n: number) => `${n} lives left`,
  rotateHint: 'Turn your phone sideways',
  enterFullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  fullscreenInstallHint: 'On iPhone: Share → "Add to Home Screen", then open it from there.',

  padFire: 'FIRE',
  padBomb: 'BOMB',

  voiceHeading: 'Voice chat',
  voiceJoin: 'Turn on mic',
  voiceMute: 'Mute me',
  voiceUnmute: 'Unmute',
  voiceLeave: 'Turn off mic',
  voiceDenied: 'The browser blocked the microphone. Allow it in the site settings and try again.',
  voiceNoDevice: 'No microphone found on this device.',
  voiceUnsupported: 'This browser does not support voice chat.',
  voiceConnecting: 'Connecting…',
  voiceConnected: 'Connected',
  voicePeerFailed: 'No connection',
  voiceIosNote: 'On iPhone: make sure the physical silent switch is off, volume is up, and Safari has microphone permission.',
  voiceFailed: (n: number) =>
    n === 1
      ? "Couldn't reach 1 player's audio — usually a mobile network."
      : `Couldn't reach ${n} players' audio — usually a mobile network.`,

  options: 'Options',
  optionsHint: 'Options (Esc)',
  close: 'Close',
  sectionSound: 'Sound',
  soundEffects: 'Sound effects',
  musicLabel: 'Music',
  musicVolume: 'Music volume',
  sectionControls: 'Controls',
  onScreenControls: 'On-screen controls',
  touchAuto: 'Auto',
  touchOn: 'On',
  touchOff: 'Off',
  touchHelpAutoTouch: 'Auto: this device looks like a touchscreen, so the pad is shown.',
  touchHelpAutoNone:
    'Auto: no touchscreen detected. Turn them On if you are on a phone and cannot see the buttons.',
  touchHelpOn: 'Always shown, whatever the browser reports about this device.',
  touchHelpOff: 'Never shown. Keyboard only.',
  sectionLanguage: 'Language',
  langHebrew: 'עברית',
  langEnglish: 'English',
  sectionMatch: 'Match',
  pauseForEveryone: 'Pause for everyone',
  onlyPlayersPause: 'Only players in the match can pause it.',
  restartMatch: 'Restart match',
  endMatch: 'End match',
  onlyHostRestart: 'Only the host can restart or end the match.',
  controlsFor: (game: string) => `${game} — controls`,
  howToPlay: 'How to play',
  backToGame: 'Back to the game',

  chooseAGame: 'Choose a game',
  playersRange: (min: number, max: number) => `${min}–${max} players`,
  playingThis: 'Playing this',

  games: {
    achtung: {
      tagline: "Draw a line. Don't touch anything.",
      controls: 'Left and right arrows, or A and D',
      rules: [
        'Your curve moves forward on its own, forever. You only steer left and right.',
        'Touching any trail — including your own — or a wall kills you.',
        'Every curve blinks out a gap now and then. That is the only way through.',
        'You score for every player who dies before you do.',
        'First to the target score wins the match.',
      ],
    },
    gunmayhem: {
      tagline: 'Shoot your friends off the stage.',
      controls: 'Arrows or WASD to move · Up to jump · Down to drop · J shoot · K bomb',
      rules: [
        'Knock everyone else off the stage. Falling off costs you a stock.',
        'Damage builds up as you get shot — the higher it is, the further the next hit sends you.',
        'You get two jumps. Thin platforms can be jumped up through, or dropped through with Down.',
        'Crates drop new weapons. Ammo is limited; you fall back to the pistol when it runs out.',
        'Find a knife and you can shank people at arm’s length — it hits hard and lunges you forward.',
        'Powerups float above the platforms: speed, jetpack, triple jump, shield, invisibility and more.',
        'Lose all your stocks and you are out. Last one standing wins the round.',
      ],
    },
  },

  setPowerups: 'Powerups',
  setWinByTwo: 'Win by two',
  setSpeed: 'Speed',
  speedLabels: ['Relaxed', 'Normal', 'Fast'],
  setPlayTo: 'Play to',
  suggestedFor: (players: number, score: number) =>
    `Suggested for ${players} ${players === 1 ? 'player' : 'players'}: ${score}`,
  setStage: 'Stage',
  stageRandom: 'Random',
  stageNames: ['The Salon', 'Rooftops', 'Towers'],
  setWeaponCrates: 'Weapon crates',
  setBombs: 'Bombs',
  setLivesEach: 'Lives each',
  setRoundsToWin: 'Rounds to win',

  colorNames: ['Red', 'Green', 'Blue', 'Yellow', 'Orange', 'Purple', 'Cyan', 'Pink'],
  colorTaken: (name: string) => `${name} — taken`,
  hatNames: ['No hat', 'Cap', 'Crown', 'Top hat', 'Horns', 'Headband', 'Halo', 'Beanie'],
  faceNames: ['Normal', 'Happy', 'Angry', 'Shades', 'Dizzy', 'Cyclops'],

  lostConnection: 'Lost the connection — trying again…',
  dismiss: 'Dismiss',
  errors: {
    BAD_MESSAGE: 'Something went wrong with that message. Try refreshing.',
    BAD_VERSION: 'This page is out of date. Refresh to get the new version.',
    NO_SUCH_ROOM: 'No room with that code. Check it and try again.',
    ROOM_FULL: 'That room is full.',
    COLOR_TAKEN: 'That colour is taken. Pick another.',
    NOT_HOST: 'Only the host can do that.',
    NOT_IN_ROOM: 'Only players in the match can do that.',
    ALREADY_STARTED: 'The match has already started.',
    NOT_ENOUGH_PLAYERS: 'Not enough players are ready.',
    RESUME_FAILED: 'Your seat is gone. Join again.',
    RATE_LIMITED: 'Slow down a moment.',
  },
};

const DICTS: Record<Lang, Dict> = { he, en };

export const LANGS: Lang[] = ['he', 'en'];

export function isLang(value: unknown): value is Lang {
  return value === 'he' || value === 'en';
}

export function dictFor(lang: Lang): Dict {
  return DICTS[lang];
}

/** RTL is a property of the language, so only this file gets to decide it. */
export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'he' ? 'rtl' : 'ltr';
}
