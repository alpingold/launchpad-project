// On the home page's idea box and /create (its own file: the home page shouldn't load /create's code).

/** Ideas to start from: games that fit a big screen and phones (plan §18). */
export const EXAMPLE_IDEAS = [
  {
    label: 'Spot the lie',
    idea: 'Everyone secretly writes two true facts about themselves and one lie. Each round the big screen shows one player\'s three, shuffled, and everyone else votes on their phone for the lie. A point for every lie you spot, and the writer gets a point for everyone they fooled. Everyone gets one turn; the best detective wins.',
  },
  {
    label: 'Grab or share',
    idea: 'A heist crew splits the loot. Each round a pile of gold appears on the big screen and everyone secretly taps Share or Grab. If everyone shares, the gold is split evenly. If exactly one player grabs, they take it all. If two or more grab, the alarm goes off and nobody gets anything. Talk it over out loud first. Richest after 6 rounds wins.',
  },
  {
    label: 'Read the judge',
    idea: 'Each round one player is the judge and the big screen shows 5 things to rank, like breakfast foods or superpowers. The judge secretly puts them in order from best to worst; everyone else tries to put them in the order the judge chose. A point for each one in the right place. The judge changes every round until everyone has judged once.',
  },
  {
    label: 'Lowest unique number',
    idea: 'Each round everyone secretly picks a number from 1 to 10 on their phone. The lowest number that nobody else picked wins the round and scores that many points. Picks that someone else also made score nothing. The big screen reveals the picks one number at a time, from 1 up. First to 15 points wins.',
  },
  {
    label: 'Find the spy',
    idea: 'Each round everyone but one player sees the same secret place on their phone, like a beach or a hospital; the spy only sees "You are the spy". The big screen asks three questions about the place ("What would you wear there?") and everyone types a short answer, shown with their name. Then everyone votes for the spy, and the big screen reveals whether they caught them. A new spy and place each round, for 5 rounds.',
  },
  {
    label: 'Draw and guess',
    idea: 'Each round one player gets a secret word and draws it on their phone; the drawing appears on the big screen as they draw. Everyone else types guesses on their phone for 60 seconds. The first right guess scores 3 points, later right guesses 1, and the drawer gets a point for each player who got it. Everyone draws twice; most points wins.',
  },
  {
    label: 'Think alike',
    idea: 'Each round the big screen asks for something like "a pizza topping" or "something in a garage". Everyone answers secretly on their phone, then the big screen reveals the answers grouped together (ignoring capitals and extra spaces). You score a point for every other player who wrote the same thing as you. Most points after 8 rounds wins.',
  },
  {
    label: 'Bluff the answer',
    idea: 'Each round the big screen shows a strange but true trivia question. Everyone writes a fake answer that sounds true. Then all the fakes and the real answer are shown shuffled, and everyone votes for the one they think is real (not their own). 2 points for finding the real answer, 1 point for each player your fake fooled. Most points after 6 questions wins.',
  },
];
