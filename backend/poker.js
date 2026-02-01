const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

const HAND_RANKINGS = {
  ROYAL_FLUSH: 10,
  STRAIGHT_FLUSH: 9,
  FOUR_OF_A_KIND: 8,
  FULL_HOUSE: 7,
  FLUSH: 6,
  STRAIGHT: 5,
  THREE_OF_A_KIND: 4,
  TWO_PAIR: 3,
  ONE_PAIR: 2,
  HIGH_CARD: 1
};

const HAND_NAMES = {
  10: 'Royal Flush',
  9: 'Straight Flush',
  8: 'Four of a Kind',
  7: 'Full House',
  6: 'Flush',
  5: 'Straight',
  4: 'Three of a Kind',
  3: 'Two Pair',
  2: 'One Pair',
  1: 'High Card'
};

export function createDeck() {
  console.log('[DECK] Creating new deck...');
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    }
  }
  console.log('[DECK] Created deck with', deck.length, 'cards');
  return deck;
}

export function shuffleDeck(deck) {
  console.log('[DECK] Shuffling deck...');
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  console.log('[DECK] Deck shuffled');
  return shuffled;
}

export function dealCards(deck, count) {
  console.log('[DECK] Dealing', count, 'cards...');
  const dealt = deck.splice(0, count);
  console.log('[DECK] Dealt:', dealt.map(c => `${c.rank}${c.suit[0]}`).join(', '));
  console.log('[DECK] Remaining cards:', deck.length);
  return dealt;
}

export function cardToString(card) {
  const suitEmojis = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
  return `${card.rank}${suitEmojis[card.suit]}`;
}

export function cardsToString(cards) {
  return cards.map(cardToString).join(' ');
}

function getCounts(cards) {
  const counts = {};
  for (const card of cards) {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  return counts;
}

function getSuitCounts(cards) {
  const counts = {};
  for (const card of cards) {
    counts[card.suit] = (counts[card.suit] || 0) + 1;
  }
  return counts;
}

function getFlush(cards) {
  const suitCounts = getSuitCounts(cards);
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count >= 5) {
      return cards.filter(c => c.suit === suit).sort((a, b) => b.value - a.value).slice(0, 5);
    }
  }
  return null;
}

function getStraight(cards) {
  const uniqueValues = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);

  if (uniqueValues.includes(14)) {
    uniqueValues.push(1);
  }

  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    let consecutive = true;
    for (let j = 0; j < 4; j++) {
      if (uniqueValues[i + j] - uniqueValues[i + j + 1] !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      const straightHighValue = uniqueValues[i];
      const straightCards = [];
      for (let v = straightHighValue; v > straightHighValue - 5; v--) {
        const actualValue = v === 1 ? 14 : v;
        const card = cards.find(c => c.value === actualValue && !straightCards.includes(c));
        if (card) straightCards.push(card);
      }
      return straightCards;
    }
  }
  return null;
}

function getStraightFlush(cards) {
  const suitCounts = getSuitCounts(cards);
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count >= 5) {
      const suitCards = cards.filter(c => c.suit === suit);
      const straight = getStraight(suitCards);
      if (straight) return straight;
    }
  }
  return null;
}

export function evaluateHand(holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];
  console.log('[HAND_EVAL] Evaluating hand:', cardsToString(holeCards), '+ community:', cardsToString(communityCards));

  if (allCards.length < 5) {
    console.log('[HAND_EVAL] Not enough cards to evaluate');
    return { ranking: 0, name: 'Incomplete', cards: [], kickers: [] };
  }

  const counts = getCounts(allCards);
  const countValues = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return RANK_VALUES[b[0]] - RANK_VALUES[a[0]];
  });

  const straightFlush = getStraightFlush(allCards);
  if (straightFlush) {
    if (straightFlush[0].value === 14) {
      console.log('[HAND_EVAL] ROYAL FLUSH!');
      return { ranking: HAND_RANKINGS.ROYAL_FLUSH, name: 'Royal Flush', cards: straightFlush, kickers: [] };
    }
    console.log('[HAND_EVAL] Straight Flush:', cardsToString(straightFlush));
    return { ranking: HAND_RANKINGS.STRAIGHT_FLUSH, name: 'Straight Flush', cards: straightFlush, kickers: [] };
  }

  if (countValues[0][1] === 4) {
    const quadRank = countValues[0][0];
    const quads = allCards.filter(c => c.rank === quadRank);
    const kicker = allCards.filter(c => c.rank !== quadRank).sort((a, b) => b.value - a.value)[0];
    console.log('[HAND_EVAL] Four of a Kind:', quadRank);
    return { ranking: HAND_RANKINGS.FOUR_OF_A_KIND, name: 'Four of a Kind', cards: quads, kickers: [kicker] };
  }

  if (countValues[0][1] === 3 && countValues[1] && countValues[1][1] >= 2) {
    const tripRank = countValues[0][0];
    const pairRank = countValues[1][0];
    const trips = allCards.filter(c => c.rank === tripRank).slice(0, 3);
    const pair = allCards.filter(c => c.rank === pairRank).slice(0, 2);
    console.log('[HAND_EVAL] Full House:', tripRank, 'full of', pairRank);
    return { ranking: HAND_RANKINGS.FULL_HOUSE, name: 'Full House', cards: [...trips, ...pair], kickers: [] };
  }

  const flush = getFlush(allCards);
  if (flush) {
    console.log('[HAND_EVAL] Flush:', cardsToString(flush));
    return { ranking: HAND_RANKINGS.FLUSH, name: 'Flush', cards: flush, kickers: [] };
  }

  const straight = getStraight(allCards);
  if (straight) {
    console.log('[HAND_EVAL] Straight:', cardsToString(straight));
    return { ranking: HAND_RANKINGS.STRAIGHT, name: 'Straight', cards: straight, kickers: [] };
  }

  if (countValues[0][1] === 3) {
    const tripRank = countValues[0][0];
    const trips = allCards.filter(c => c.rank === tripRank);
    const kickers = allCards.filter(c => c.rank !== tripRank).sort((a, b) => b.value - a.value).slice(0, 2);
    console.log('[HAND_EVAL] Three of a Kind:', tripRank);
    return { ranking: HAND_RANKINGS.THREE_OF_A_KIND, name: 'Three of a Kind', cards: trips, kickers };
  }

  if (countValues[0][1] === 2 && countValues[1] && countValues[1][1] === 2) {
    const highPairRank = countValues[0][0];
    const lowPairRank = countValues[1][0];
    const highPair = allCards.filter(c => c.rank === highPairRank).slice(0, 2);
    const lowPair = allCards.filter(c => c.rank === lowPairRank).slice(0, 2);
    const kicker = allCards.filter(c => c.rank !== highPairRank && c.rank !== lowPairRank).sort((a, b) => b.value - a.value)[0];
    console.log('[HAND_EVAL] Two Pair:', highPairRank, 'and', lowPairRank);
    return { ranking: HAND_RANKINGS.TWO_PAIR, name: 'Two Pair', cards: [...highPair, ...lowPair], kickers: kicker ? [kicker] : [] };
  }

  if (countValues[0][1] === 2) {
    const pairRank = countValues[0][0];
    const pair = allCards.filter(c => c.rank === pairRank);
    const kickers = allCards.filter(c => c.rank !== pairRank).sort((a, b) => b.value - a.value).slice(0, 3);
    console.log('[HAND_EVAL] One Pair:', pairRank);
    return { ranking: HAND_RANKINGS.ONE_PAIR, name: 'One Pair', cards: pair, kickers };
  }

  const highCards = allCards.sort((a, b) => b.value - a.value).slice(0, 5);
  console.log('[HAND_EVAL] High Card:', highCards[0].rank);
  return { ranking: HAND_RANKINGS.HIGH_CARD, name: 'High Card', cards: [highCards[0]], kickers: highCards.slice(1) };
}

export function compareHands(hand1, hand2) {
  if (hand1.ranking !== hand2.ranking) {
    return hand2.ranking - hand1.ranking;
  }

  for (let i = 0; i < hand1.cards.length && i < hand2.cards.length; i++) {
    if (hand1.cards[i].value !== hand2.cards[i].value) {
      return hand2.cards[i].value - hand1.cards[i].value;
    }
  }

  for (let i = 0; i < hand1.kickers.length && i < hand2.kickers.length; i++) {
    if (hand1.kickers[i].value !== hand2.kickers[i].value) {
      return hand2.kickers[i].value - hand1.kickers[i].value;
    }
  }

  return 0;
}

export function determineWinners(players, communityCards) {
  console.log('[WINNERS] Determining winners among', players.length, 'players');

  const evaluations = players.map(player => ({
    player,
    hand: evaluateHand(player.hole_cards, communityCards)
  }));

  evaluations.sort((a, b) => compareHands(a.hand, b.hand));

  const winners = [evaluations[0]];
  for (let i = 1; i < evaluations.length; i++) {
    if (compareHands(evaluations[0].hand, evaluations[i].hand) === 0) {
      winners.push(evaluations[i]);
    } else {
      break;
    }
  }

  console.log('[WINNERS] Winner(s):', winners.map(w => `${w.player.moltbook_name} with ${w.hand.name}`).join(', '));
  return winners;
}

export const BLINDS = {
  SMALL: 1,
  BIG: 2
};

export const GAME_PHASES = {
  WAITING: 'waiting',
  PRE_FLOP: 'pre_flop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
};

export const ACTION_TIMEOUT_MS = 8000;

export { HAND_RANKINGS, HAND_NAMES, SUITS, RANKS };
