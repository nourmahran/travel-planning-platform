export interface SelectableRoom {
  maxAdults: number;
  maxChildren: number;
  basePricePerNightCents: number;
}

export interface RoomSelection<T extends SelectableRoom> {
  rooms: T[];
  pricePerNightCents: number;
}

interface State {
  cost: number;
  indices: number[];
}

/**
 * HTL-11/HTL-15 search helper: cheapest set of exactly `roomsNeeded` rooms
 * whose combined capacity covers `guests`.
 *
 * A small dynamic program (rooms ≤ 5, guests ≤ 16) keeps the search cheap and
 * avoids the classic "cheapest rooms cannot host the party" bug. The booking
 * endpoint still re-validates the precise adult/child split per room.
 */
export function selectCheapestRoomCombination<T extends SelectableRoom>(
  rooms: T[],
  roomsNeeded: number,
  guests: number,
): RoomSelection<T> | null {
  if (roomsNeeded < 1 || guests < 1 || rooms.length < roomsNeeded) {
    return null;
  }

  const capacityGoal = guests;
  const dp: (State | null)[][] = Array.from({ length: roomsNeeded + 1 }, () =>
    Array<State | null>(capacityGoal + 1).fill(null),
  );
  dp[0][0] = { cost: 0, indices: [] };

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const capacity = Math.min(room.maxAdults + room.maxChildren, capacityGoal);
    for (let used = Math.min(roomsNeeded - 1, index); used >= 0; used -= 1) {
      for (let covered = 0; covered <= capacityGoal; covered += 1) {
        const state = dp[used][covered];
        if (!state) {
          continue;
        }
        const nextCovered = Math.min(covered + capacity, capacityGoal);
        const nextCost = state.cost + room.basePricePerNightCents;
        const existing = dp[used + 1][nextCovered];
        if (!existing || nextCost < existing.cost) {
          dp[used + 1][nextCovered] = {
            cost: nextCost,
            indices: [...state.indices, index],
          };
        }
      }
    }
  }

  const best = dp[roomsNeeded][capacityGoal];
  if (!best) {
    return null;
  }

  return {
    rooms: best.indices.map((index) => rooms[index]),
    pricePerNightCents: best.cost,
  };
}
