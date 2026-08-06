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
  inviteShareText: (code: string) => `בואו לשחק איתי בהסלון. קוד החדר: ${code}`,
  inviteAppTitle: 'כבר התקנתם את האפליקציה?',
  inviteAppBody: (code: string) =>
    `Safari לא יכול להעביר את הקישור לאפליקציה. העתיקו את הקוד ${code}, פתחו את הסלון ממסך הבית והצטרפו איתו.`,
  copyRoomCode: 'העתיקו את קוד החדר',
  whosHere: 'מי כאן',
  outOf: (n: number, max: number) => `(${n}/${max})`,
  suffixYou: ' (זה אתם)',
  metaHost: 'מארח · ',
  metaAway: 'לא מחובר',
  metaReady: 'סופר מוכן',
  metaNotReady: 'לא מוכן',
  ready: 'אני מוכן ומזומן',
  notReady: 'חכה אני לא מוכן!',
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
  paused: 'תגידו מו - מושהה',
  pausedBy: (name: string) => `${name} עצר את המשחק`,
  pausedByNobody: 'עצרנו לרגע תמשחק',
  resume: 'להמשיך!',
  waitingForPlayer: 'מחכים שמישהו ימשיך…',
  matchOver: 'איזה באסה נגמר המשחק',
  winner: (name: string) => `${name} ניצח`,
  nobodyWins: 'אף אחד לא ניצח',
  totalScoreTitle: 'ניקוד מצטבר בחדר הזה, על פני כל המשחקים',
  totalScoreLabel: (n: number) => `סה״כ ${n}`,
  /** One picked at random per match end. Silly on purpose — this is a living room. */
  winnerQuips: (name: string) => [
    `כל הכבוד ל${name}! בטח מתאמן בבית...`,
    `${name} נגד ליל מוג' מוג' חמינאי מי ינצח?`,
    `המשחק מכור, השופט משוחד, ו${name} לא סופר פה אף אחד`,
    'לא שותים בזמן שמשחקים',
    `אולי להעביר ל${name} כמה שקלים בביט כפרס?`,
  ],
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
  fullscreenInstallHint: 'כדי שתוכלו להגדיל את המסך. ב־iPhone: שתפו ← «הוסף למסך הבית», ופתחו משם למסך מלא.',

  // First-visit iPhone install prompt.
  installTitle: 'יותר מקום למשחק באייפון',
  installBenefit:
    'הוסיפו את הסלון למסך הבית ותקבלו מסך משחק גדול יותר בלי סרגלי Safari, כפתורים נוחים יותר וכניסה מהירה בפעם הבאה.',
  installStepShare: 'בסרגל של Safari, לחצו על כפתור השיתוף שנראה בדיוק כך:',
  installStepHome: 'בתפריט שנפתח בחרו „הוספה למסך הבית”, ואז פתחו את הסלון מהסמל החדש.',
  installDismiss: 'הבנתי — אוסיף למסך הבית',

  // Touch controls. Short on purpose — they are printed inside the buttons.
  padFire: 'ירי',
  padBomb: 'בוםבום',
  padFlip: 'הפוך',

  // Voice chat
  voiceListening: 'אפשר לשמוע את החדר',
  voiceDeafen: 'השתיקו את החדר',
  voiceUndeafen: 'החזירו את השמע',
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
  voiceRetry: 'נסו לחבר שוב',
  voiceTapToHear: 'הקישו פעם אחת כדי לשמוע את החדר.',
  voiceRelayUnavailable: 'החיבור הקולי מוגבל כרגע — רשת סלולרית עלולה לא לעבוד.',
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
  muteAudio: 'השתקת שמע',
  unmuteAudio: 'ביטול השתקת שמע',
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
  pauseForEveryone: 'עצרו כולם!',
  onlyPlayersPause: 'רק מי שמשחק יכול להשהות.',
  restartMatch: 'התחלת משחק מחדש',
  endMatch: 'סיימו את המשחק',
  onlyHostRestart: 'רק המארח יכול להתחיל מחדש או לסיים.',
  controlsFor: (game: string) => `${game} — שליטה`,
  howToPlay: 'איך משחקים',
  backToGame: 'חזרה למשחק',
  reloadApp: 'טעינה מחדש של האפליקציה',

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------
  chooseAGame: 'בחרו משחק',
  playersRange: (min: number, max: number) => `${min}–${max} שחקנים`,
  playingThis: 'משחקים את זה',

  // Game names stay as they are — they are proper nouns in both languages.
  games: {
    achtung: {
      name: 'אכטונג די קורבה',
      tagline: 'להחזיר את החוש האומנותי מכיתה ג',
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
      name: 'גאן מייהם',
      tagline: 'מלא יריות ומלא צחוקים',
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
    skribbl: {
      name: 'סקריבל',
      tagline: 'תקשקשו על המסך בזמן שמקשקשים עם החברים',
      controls: 'ציירו עם העכבר או האצבע · הקלידו ניחוש בצ׳אט',
      rules: [
        'בכל סיבוב אחד מצייר וכל השאר מנחשים.',
        'המצייר בוחר מילה אחת מתוך שלוש.',
        'הקלידו ניחושים בצ׳אט — ככל שתנחשו מהר יותר, כך תקבלו יותר נקודות.',
        'אותיות מתגלות ככל שהזמן אוזל.',
        'המצייר מקבל נקודות על כל מי שניחש.',
      ],
    },
    memes: {
      name: 'מכונת הממים',
      tagline: 'כותבים יחד, צוחקים אחד על השני',
      controls: 'כתבו כיתוב · הצביעו 👍 😐 👎',
      rules: [
        'כולם מקבלים תמונה אחרת וכותבים כיתוב באותו הזמן.',
        'הממים נחשפים אחד־אחד בלי לגלות מי כתב.',
        'הצביעו לייק, ניטרלי או דיסלייק — חוץ מהמם שלכם.',
        'המם הטוב בסיבוב מקבל בונוס.',
        'מי שצובר הכי הרבה נקודות מנצח.',
      ],
    },
    tanks: {
      name: 'טנק טראבל',
      tagline: 'לירות מעבר לפינה, בדרך כלל על עצמכם',
      controls: 'חצים או WASD לנהיגה · M או רווח לירי',
      rules: [
        'נוסעים במבוך ויורים על הטנקים האחרים. האחרון ששורד מנצח בסיבוב.',
        'הפגזים מוקפצים מהקירות — הירי הטוב הוא זה שחוזר מעבר לפינה.',
        'הפגז שלכם יכול להרוג גם אתכם ברגע שיצא מהקנה. בדרך כלל זה מה שקורה.',
        'עד שישה פגזים באוויר בו־זמנית, ועם הפסקה קצרה בין יריות.',
        'שדרוגים מופיעים במבוך: מגן, ירי משולש, מהירות, פגז כבד, טעינה מהירה, קפיצות נוספות, רפאים ומיני.',
        'אם הזמן נגמר, או ששני הטנקים האחרונים מתים יחד — הסיבוב מסתיים בתיקו.',
        'הראשון שמגיע למספר הסיבובים שנקבע מנצח במשחק.',
      ],
    },
    gravity: {
      name: 'גראביטי גאי',
      tagline: 'כפתור אחד. לרוץ זה חובה, ליפול זה בחירה',
      controls: 'רווח, חץ למעלה, או נגיעה במסך כדי להפוך כיוון',
      rules: [
        'אתם רצים ימינה לבד ואי אפשר לעצור. כפתור אחד הופך את כיוון הכבידה.',
        'הפיכת כיוון בזמן שאתם על משטח משגרת אתכם לצד השני. אין קפיצה.',
        'נפילה לתוך בור או התנגשות בקיר מוציאה אתכם מהסיבוב.',
        'כולם רצים באותה מהירות, והיא רק הולכת ועולה.',
        'האחרון שממשיך לרוץ מנצח בסיבוב — או הראשון שמגיע לסוף המסלול.',
        'הראשון שמגיע למספר הסיבובים שנקבע מנצח במשחק.',
      ],
    },
  } satisfies Record<GameId, { name: string; tagline: string; controls: string; rules: string[] }>,

  // -------------------------------------------------------------------------
  // Settings panels
  // -------------------------------------------------------------------------
  achtungEffects: {
    speedUp: 'מהר',
    speedDown: 'לאט',
    thin: 'דק',
    thick: 'עבה',
    ghost: 'רוח',
    invert: 'היפוך',
  },
  setPowerups: 'שדרוגים',
  setWinByTwo: 'ניצחון בהפרש שתיים',
  setSpeed: 'מהירות',
  speedLabels: ['רגוע', 'רגיל', 'מהיר'],
  setPlayTo: 'משחקים עד',
  suggestedFor: (players: number, score: number) =>
    `מומלץ ל-${players} ${players === 1 ? 'שחקן' : 'שחקנים'}: ${score}`,
  setStage: 'במה',
  stageRandom: 'אקראי',
  stageNames: [
    'עולם הממתקים',
    'מדבר',
    'מפעל',
    'גבעות ירוקות',
    'רכס אלפיני',
    'סלון ביתי',
    'פסגות מושלגות',
  ],
  setWeaponCrates: 'ארגזי נשק',
  setBombs: 'פצצות',
  setLivesEach: 'חיים לכל אחד',
  setRoundsToWin: 'סיבובים לניצחון',
  setArenaSize: 'גודל המבוך',
  arenaSizeLabels: ['קטן', 'רגיל', 'גדול'],
  setRoundSeconds: 'שניות לסיבוב',
  setPace: 'קצב',
  paceLabels: ['רגוע', 'רגיל', 'מהיר'],

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Skribbl
  // -------------------------------------------------------------------------
  skribblRound: (n: number, of: number) => `סיבוב ${n}/${of}`,
  skribblYourTurn: 'תורכם לצייר — בחרו מילה',
  skribblChoosing: (name: string) => `${name} בוחר מילה…`,
  skribblGetReady: 'מתחילים…',
  skribblYouAreDrawing: 'אתם מציירים — בלי לרמוז!',
  skribblAlreadyGot: 'ניחשתם נכון! 🎉',
  skribblWaitToGuess: 'מחכים לציור…',
  skribblGuessPlaceholder: 'מה זה? כתבו כאן…',
  skribblGuessNow: 'נחשו בצ׳אט!',
  skribblGotIt: (name: string) => `${name} ניחש נכון!`,
  skribblClose: 'קרוב מאוד!',
  skribblWordWas: (word: string) => `המילה הייתה: ${word}`,
  skribblWordWasShort: 'המילה הייתה',
  skribblPickPrompt: 'בחרו מה לצייר',
  skribblAutoPick: (n: number) => `בעוד ${n} שניות נבחר עבורכם`,
  skribblEasy: 'קל',
  skribblMedium: 'בינוני',
  skribblHard: 'קשה',
  skribblDrawingTag: 'מצייר',
  skribblColour: 'צבע',
  skribblBrush: 'עובי',
  skribblEraser: 'מחק',
  skribblUndo: 'בטלו',
  skribblClear: 'נקו הכל',
  skribblFill: 'מילוי',
  skribblSubmit: 'שלח',
  // Settings
  skribblWordLanguage: 'שפת המילים',
  skribblDrawTime: 'זמן ציור',
  skribblSeconds: (n: number) => `${n} שנ׳`,
  skribblRounds: 'סיבובים',
  skribblHints: 'רמזים',
  skribblHintsHelp: 'אותיות מתגלות אחת אחרי השנייה ככל שהזמן אוזל.',

  // Meme Machine
  memesRound: (n: number, of: number) => `סיבוב ${n} מתוך ${of}`,
  memesWriteTime: 'זמן לכתיבה',
  memesVoteTime: 'זמן להצבעה',
  memesRounds: 'סיבובים',
  memesNudges: 'רעיונות לכיתוב',
  memesNudgesHelp: 'הציגו שורת השראה קצרה מתחת לתמונה.',
  memesSeconds: (n: number) => `${n} שנ׳`,
  memesIntro: 'מכונת הממים מתחממת…',
  memesWrite: 'תנו לתמונה כיתוב',
  memesCaption: (n: number) => `כיתוב ${n}`,
  memesCaptionPlaceholder: 'מה קורה כאן?',
  memesCharacters: (n: number, max: number) => `${n}/${max}`,
  memesMoveCaption: (n: number) => `הזיזו את כיתוב ${n}`,
  memesResizeCaption: (n: number) => `שנו את גודל כיתוב ${n}`,
  memesAddCaption: 'הוסיפו תיבת טקסט',
  memesRemoveCaption: 'הסירו',
  memesSubmit: 'סיימתי',
  memesSubmitted: 'הכיתוב בפנים!',
  memesWaitingWriters: 'מי כבר סיים',
  memesReveal: (n: number, of: number) => `מם ${n} מתוך ${of}`,
  memesVote: 'מה דעתכם?',
  memesLike: 'מצחיק',
  memesNeutral: 'ככה ככה',
  memesDislike: 'לא הפעם',
  memesYours: 'זה שלכם — אסור להצביע',
  memesBallots: (n: number, of: number) => `${n} מתוך ${of} הצביעו`,
  memesBy: (name: string) => `של ${name}`,
  memesAward: (n: number) => `+${n} נקודות`,
  memesStandings: 'טבלת הסיבוב',
  memesTop: 'המם המנצח',
  memesSpectating: 'אתם צופים בסיבוב הזה',
  memesTenSeconds: 'נשארו עשר שניות',
  memesDownload: 'הורדת המם',
  memesDownloading: 'מכינים תמונה…',
  memesDownloadFailed: 'לא הצלחנו להוריד את המם',

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
    BAD_VERSION: 'הדף הזה ישן רצח. תרעננו כדי לעדכן!.',
    NO_SUCH_ROOM: 'חיפשתם חדר שלא קיים, כנראה סקיבידי טעות.',
    ROOM_FULL: 'החדר מלא.',
    COLOR_TAKEN: 'הצבע הזה כבר תפוס, אבל הוא מכוער בכל מקרה...',
    NOT_HOST: 'רק המארח יכול לעשות את זה.',
    NOT_IN_ROOM: 'רק מי שמשחק יכול לעשות את זה.',
    ALREADY_STARTED: 'המשחק כבר התחיל.',
    NOT_ENOUGH_PLAYERS: 'אין מספיק שחקנים מוכנים..',
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
  inviteShareText: (code: string) => `Come play with me in הסלון. Room code: ${code}`,
  inviteAppTitle: 'Already installed the app?',
  inviteAppBody: (code: string) =>
    `Safari cannot hand this link to the app. Copy code ${code}, open הסלון from your Home Screen, and join with it.`,
  copyRoomCode: 'Copy room code',
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
  totalScoreTitle: 'Total points in this room, across every game',
  totalScoreLabel: (n: number) => `total ${n}`,
  /** One picked at random per match end. Silly on purpose — this is a living room. */
  winnerQuips: (name: string) => [
    'Science cannot yet explain how.',
    `Someone get ${name} a throne.`,
    'Called it. Nobody else did.',
    'Enjoy your 15 seconds of fame.',
    'Bragging rights secured for the group chat.',
    'Their ego is now bigger than the screen.',
    "It's probably the chair.",
    'Experts are stunned. You are, checks notes, less so.',
  ],
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

  // First-visit iPhone install prompt.
  installTitle: 'Give the game more room on iPhone',
  installBenefit:
    'Add הסלון to your Home Screen for a larger game area without Safari bars, easier controls, and one-tap access next time.',
  installStepShare: 'In Safari’s toolbar, tap the Share button that looks exactly like this:',
  installStepHome: 'Choose “Add to Home Screen”, then open הסלון from its new icon.',
  installDismiss: 'Got it — I’ll add it',

  padFire: 'FIRE',
  padBomb: 'BOMB',
  padFlip: 'FLIP',

  voiceHeading: 'Voice chat',
  voiceListening: 'You can hear the room',
  voiceDeafen: 'Mute room audio',
  voiceUndeafen: 'Turn hearing back on',
  voiceJoin: 'Turn on mic',
  voiceMute: 'Mute me',
  voiceUnmute: 'Unmute',
  voiceLeave: 'Turn off mic',
  voiceDenied: 'The browser blocked the microphone. Allow it in the site settings and try again.',
  voiceNoDevice: 'No microphone found on this device.',
  voiceUnsupported: 'This browser does not support voice chat.',
  voiceConnecting: 'Connecting…',
  voiceConnected: 'Connected',
  voiceRetry: 'Retry voice',
  voiceTapToHear: 'Tap once to hear the room.',
  voiceRelayUnavailable: 'Voice relay is unavailable; cellular networks may not connect.',
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
  muteAudio: 'Mute sound',
  unmuteAudio: 'Unmute sound',
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
  reloadApp: 'Reload app',

  chooseAGame: 'Choose a game',
  playersRange: (min: number, max: number) => `${min}–${max} players`,
  playingThis: 'Playing this',

  games: {
    achtung: {
      name: 'Achtung die Kurve',
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
      name: 'Gun Mayhem',
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
    skribbl: {
      name: 'Skribbl',
      tagline: 'One draws. Everyone else guesses.',
      controls: 'Draw with the mouse or a finger · type your guess in the chat',
      rules: [
        'Each round one player draws and everyone else guesses.',
        'The drawer picks one of three words.',
        'Type guesses in the chat — the faster you get it, the more it is worth.',
        'Letters appear as the clock runs down.',
        'The drawer scores for every person who gets it.',
      ],
    },
    memes: {
      name: 'Meme Machine',
      tagline: 'Write together. Laugh at each other.',
      controls: 'Write a caption · vote 👍 😐 👎',
      rules: [
        'Everyone gets a different image and writes at the same time.',
        'Memes are revealed one by one with the author hidden.',
        'Vote like, neutral, or dislike — except on your own meme.',
        'The best meme each round earns a bonus.',
        'The player with the most points wins.',
      ],
    },
    tanks: {
      name: 'Tank Trouble',
      tagline: 'Shoot round corners. Mostly at yourself.',
      controls: 'Arrows or WASD to drive · M or Space to shoot',
      rules: [
        'Drive around a maze and shoot the other tanks. Last one alive wins the round.',
        'Shells bounce off walls — the good shots are the ones that come round a corner.',
        'Your own shells can kill you once they have left the barrel. They usually do.',
        'Six shells in the air at a time, and a short pause between shots.',
        'Powerups drop in the maze: shield, triple shot, speed, heavy shell, rapid reload, extra bounces, ghost and mini.',
        'If the clock runs out, or the last two tanks die together, the round is a draw.',
        'First to the target number of rounds wins the match.',
      ],
    },
    gravity: {
      name: 'Gravity Guy',
      tagline: 'One button. Falling is optional; running is not.',
      controls: 'Space, Up, or tap anywhere to flip',
      rules: [
        'You run to the right on your own and you cannot stop. One button flips gravity.',
        'Flipping while stuck to a surface throws you at the other one. There is no jump.',
        'Fall through a gap or run into a wall and you are out for the round.',
        'Everyone runs at the same speed, and it keeps going up.',
        'Last one running wins the round — or the first to reach the end of the track.',
        'First to the target number of rounds wins the match.',
      ],
    },
  },

  achtungEffects: {
    speedUp: 'Fast',
    speedDown: 'Slow',
    thin: 'Thin',
    thick: 'Thick',
    ghost: 'Ghost',
    invert: 'Invert',
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
  stageNames: [
    'Candyland',
    'Desert',
    'Factory',
    'Green Hills',
    'Highland Ridge',
    'Living Room',
    'Snowy Peaks',
  ],
  setWeaponCrates: 'Weapon crates',
  setBombs: 'Bombs',
  setLivesEach: 'Lives each',
  setRoundsToWin: 'Rounds to win',
  setArenaSize: 'Maze size',
  arenaSizeLabels: ['Small', 'Normal', 'Large'],
  setRoundSeconds: 'Seconds per round',
  setPace: 'Pace',
  paceLabels: ['Chill', 'Normal', 'Fast'],


  // -------------------------------------------------------------------------
  // Skribbl
  // -------------------------------------------------------------------------
  skribblRound: (n: number, of: number) => `Round ${n}/${of}`,
  skribblYourTurn: 'Your turn — pick a word',
  skribblChoosing: (name: string) => `${name} is choosing a word…`,
  skribblGetReady: 'Starting…',
  skribblYouAreDrawing: "You're drawing — no hints!",
  skribblAlreadyGot: 'You got it! 🎉',
  skribblWaitToGuess: 'Waiting for the drawing…',
  skribblGuessPlaceholder: 'What is it? Type here…',
  skribblGuessNow: 'Guess in the chat!',
  skribblGotIt: (name: string) => `${name} guessed it!`,
  skribblClose: 'So close!',
  skribblWordWas: (word: string) => `The word was: ${word}`,
  skribblWordWasShort: 'The word was',
  skribblPickPrompt: 'Pick something to draw',
  skribblAutoPick: (n: number) => `Choosing for you in ${n}s`,
  skribblEasy: 'Easy',
  skribblMedium: 'Medium',
  skribblHard: 'Hard',
  skribblDrawingTag: 'drawing',
  skribblColour: 'Colour',
  skribblBrush: 'Brush',
  skribblEraser: 'Eraser',
  skribblUndo: 'Undo',
  skribblClear: 'Clear',
  skribblFill: 'Fill',
  skribblSubmit: 'Send / Submit',
  // Settings
  skribblWordLanguage: 'Word language',
  skribblDrawTime: 'Drawing time',
  skribblSeconds: (n: number) => `${n}s`,
  skribblRounds: 'Rounds',
  skribblHints: 'Hints',
  skribblHintsHelp: 'Letters appear one by one as the clock runs down.',

  // Meme Machine
  memesRound: (n: number, of: number) => `Round ${n} of ${of}`,
  memesWriteTime: 'Writing time',
  memesVoteTime: 'Voting time',
  memesRounds: 'Rounds',
  memesNudges: 'Caption nudges',
  memesNudgesHelp: 'Show a short inspiration line beneath the image.',
  memesSeconds: (n: number) => `${n}s`,
  memesIntro: 'Warming up the Meme Machine…',
  memesWrite: 'Caption your image',
  memesCaption: (n: number) => `Caption ${n}`,
  memesCaptionPlaceholder: 'What is happening here?',
  memesCharacters: (n: number, max: number) => `${n}/${max}`,
  memesMoveCaption: (n: number) => `Move caption ${n}`,
  memesResizeCaption: (n: number) => `Resize caption ${n}`,
  memesAddCaption: 'Add text box',
  memesRemoveCaption: 'Remove',
  memesSubmit: 'Submit',
  memesSubmitted: 'Caption locked in!',
  memesWaitingWriters: 'Who is finished',
  memesReveal: (n: number, of: number) => `Meme ${n} of ${of}`,
  memesVote: 'What do you think?',
  memesLike: 'Funny',
  memesNeutral: 'So-so',
  memesDislike: 'Not this one',
  memesYours: "This one is yours — you can't vote",
  memesBallots: (n: number, of: number) => `${n} of ${of} voted`,
  memesBy: (name: string) => `by ${name}`,
  memesAward: (n: number) => `+${n} points`,
  memesStandings: 'Round standings',
  memesTop: 'Top meme',
  memesSpectating: 'You are watching this round',
  memesTenSeconds: 'Ten seconds left',
  memesDownload: 'Download meme',
  memesDownloading: 'Preparing image…',
  memesDownloadFailed: 'Could not download this meme',

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
