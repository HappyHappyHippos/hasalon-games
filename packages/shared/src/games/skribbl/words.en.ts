/**
 * English words to draw. Same shape and same rules as `words.he.ts`.
 *
 * The two lists are deliberately *not* translations of each other. A word is
 * only worth including if it is drawable and instantly recognisable to the
 * people playing, and that is a different set in each language — "שקשוקה" and
 * "piñata" both belong on exactly one of these lists.
 */

export const EN_EASY: string[] = [
  'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'rainbow', 'fire', 'water', 'mountain',
  'sea', 'beach', 'tree', 'flower', 'leaf', 'grass', 'forest', 'desert', 'island', 'river',
  'dog', 'cat', 'horse', 'cow', 'sheep', 'goat', 'pig', 'rooster', 'duck', 'goose',
  'fish', 'shark', 'whale', 'dolphin', 'octopus', 'crab', 'turtle', 'snake', 'frog', 'lizard',
  'bird', 'eagle', 'owl', 'parrot', 'penguin', 'elephant', 'lion', 'tiger', 'bear', 'monkey',
  'giraffe', 'zebra', 'kangaroo', 'mouse', 'rabbit', 'fox', 'wolf', 'deer', 'camel', 'donkey',
  'bee', 'butterfly', 'ant', 'spider', 'mosquito', 'fly', 'snail', 'worm',
  'house', 'door', 'window', 'roof', 'stairs', 'key', 'lock', 'fence', 'gate', 'chimney',
  'chair', 'table', 'bed', 'sofa', 'closet', 'shelf', 'carpet', 'curtain', 'mirror', 'lamp',
  'cup', 'plate', 'spoon', 'fork', 'knife', 'bowl', 'bottle', 'pot', 'pan', 'kettle',
  'bread', 'egg', 'cheese', 'milk', 'butter', 'honey', 'sugar', 'salt', 'rice', 'pasta',
  'apple', 'banana', 'grapes', 'strawberry', 'watermelon', 'lemon', 'orange', 'pear', 'pineapple', 'cherry',
  'tomato', 'cucumber', 'carrot', 'onion', 'potato', 'pepper', 'lettuce', 'corn', 'mushroom',
  'cake', 'cookie', 'ice cream', 'chocolate', 'candy', 'popcorn', 'pizza', 'burger', 'fries',
  'ball', 'doll', 'robot', 'kite', 'bicycle', 'car', 'bus', 'train', 'plane', 'boat',
  'ship', 'helicopter', 'tractor', 'truck', 'motorcycle', 'scooter', 'wagon',
  'dress', 'shirt', 'trousers', 'shoe', 'sock', 'hat', 'coat', 'scarf', 'glove', 'belt',
  'pencil', 'pen', 'notebook', 'book', 'scissors', 'ruler', 'eraser', 'glue', 'bag', 'board',
  'clock', 'phone', 'computer', 'television', 'camera', 'umbrella', 'soap', 'brush', 'comb',
];

export const EN_MEDIUM: string[] = [
  'guitar', 'piano', 'drum', 'flute', 'violin', 'trumpet', 'accordion', 'headphones', 'speaker',
  'lighthouse', 'windmill', 'bridge', 'tunnel', 'fountain', 'statue', 'palace', 'castle', 'fortress',
  'tent', 'campfire', 'backpack', 'compass', 'map', 'binoculars', 'torch', 'rope', 'ladder', 'anchor',
  'doctor', 'police officer', 'firefighter', 'chef', 'teacher', 'driver', 'barber', 'painter', 'singer',
  'astronaut', 'diver', 'goalkeeper', 'referee', 'farmer', 'fisherman', 'carpenter', 'baker',
  'wizard', 'clown', 'pirate', 'knight', 'princess', 'king', 'queen', 'witch', 'fairy', 'dwarf',
  'giant', 'dragon', 'unicorn', 'ghost', 'skeleton', 'mummy', 'vampire', 'zombie', 'alien', 'monster',
  'telescope', 'microscope', 'remote', 'keyboard', 'battery', 'plug', 'lightbulb', 'fan',
  'fridge', 'oven', 'washing machine', 'vacuum', 'dishwasher', 'microwave', 'iron', 'toaster',
  'roller coaster', 'carousel', 'ferris wheel', 'slide', 'swing', 'sandbox', 'pool', 'trampoline',
  'football', 'basketball', 'tennis', 'swimming', 'running', 'skiing', 'surfing', 'chess', 'cards',
  'medal', 'trophy', 'flag', 'whistle', 'net', 'racket', 'helmet', 'dumbbell', 'archery',
  'dentist', 'syringe', 'bandage', 'cast', 'glasses', 'stethoscope', 'crutches',
  'volcano', 'glacier', 'cave', 'waterfall', 'swamp', 'storm', 'lightning', 'tornado', 'earthquake',
  'pyramid', 'sphinx', 'eiffel tower', 'great wall', 'colosseum', 'windmill farm', 'igloo',
  'sleeping bag', 'hammock', 'suitcase', 'passport', 'ticket', 'coin', 'banknote', 'wallet', 'safe',
  'letter', 'stamp', 'envelope', 'mailbox', 'newspaper', 'magazine', 'necklace', 'ring', 'earring',
  'ribbon', 'present', 'balloon', 'candle', 'fireworks', 'confetti', 'birthday cake', 'party hat',
  'pumpkin', 'snowman', 'christmas tree', 'turkey', 'piñata', 'wreath', 'sleigh', 'reindeer',
  'stage', 'projector', 'cinema ticket', 'orchestra', 'choir', 'microphone', 'spotlight',
  'calculator', 'globe', 'billboard', 'traffic light', 'road sign', 'thermometer', 'scales',
  'treasure chest', 'message in a bottle', 'hourglass', 'crown', 'sword', 'shield', 'catapult',
];

export const EN_HARD: string[] = [
  'embassy', 'stock market', 'inflation', 'democracy', 'election', 'ballot box', 'constitution', 'lawyer',
  'gravity', 'evolution', 'dna', 'bacteria', 'virus', 'vaccine', 'molecule', 'atom', 'magnet',
  'black hole', 'galaxy', 'meteor', 'satellite', 'space station', 'eclipse', 'comet', 'gravity well',
  'memory', 'dream', 'nightmare', 'nostalgia', 'jealousy', 'shame', 'surprise', 'boredom', 'stress',
  'deja vu', 'awkwardness', 'hope', 'patience', 'curiosity', 'courage', 'shyness', 'relief',
  'bureaucracy', 'traffic jam', 'long queue', 'electricity bill', 'job interview', 'parents evening',
  'fire drill', 'jet lag', 'hangover', 'monday morning', 'group project', 'spam email',
  'lost remote', 'odd sock', 'dead battery', 'selfie', 'emoji', 'hashtag', 'autocorrect',
  'computer virus', 'password', 'the cloud', 'server', 'source code', 'bug', 'pixel', 'qr code',
  'archaeologist', 'palaeontologist', 'astronomer', 'chemist', 'biologist', 'mathematician', 'philosopher',
  'conductor', 'acrobat', 'mentalist', 'mime', 'cartoonist', 'linguist', 'sommelier',
  'shoelaces', 'wrinkle', 'shadow', 'echo', 'smell', 'taste', 'balance', 'symmetry', 'infinity',
  'time', 'luck', 'secret', 'lie', 'truth', 'freedom', 'silence', 'noise', 'chaos', 'order',
  'gravity boots', 'time machine', 'parallel universe', 'invisibility', 'teleportation',
];

/** Everything, with its tier, in one list — see `words.ts` for the picker. */
export const EN_WORDS = { easy: EN_EASY, medium: EN_MEDIUM, hard: EN_HARD };
