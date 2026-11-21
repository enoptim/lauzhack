/// <reference types="vite/client" />
import inventoryCsv from '../../../../data/inventory.csv?raw';
import optionsCsv from '../../../../data/options.csv?raw';
import roomsCsv from '../../../../data/rooms.csv?raw';
import { FLOOR_COUNT, FLOOR_HEIGHT, LAYOUT_LENGTH, LAYOUT_WIDTH, LENGTH, WIDTH } from '@/data/building';
import { sideRooms } from '@/data/sideRooms';
import type { Scenario } from '@/api/types';

function csvRecords(csv: string) {
  // Quoted fields can contain commas, line breaks and escaped quotes.
  const rows: string[][] = [[]];
  let row = rows[0];
  for (const [, quoted, plain, delimiter] of csv.trimEnd().matchAll(/(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r?\n|$)/g)) {
    row.push(quoted === undefined ? plain : quoted.replaceAll('""', '"'));
    if (delimiter.includes('\n')) {
      row = [];
      rows.push(row);
    }
  }
  const [header, ...records] = rows;
  return records.map(fields => Object.fromEntries(header.map((key, index) => [key, fields[index]])));
}

export const lightingOptions = csvRecords(optionsCsv).filter(row => row.group === 'lighting');
const rooms = new Map(csvRecords(roomsCsv).map(room => [room.room_id, room]));

function markerPosition(roomId: string, floor: number, east: number, north: number): [number, number, number] {
  const y = floor * FLOOR_HEIGHT + 2.9;
  const teachingRoom = sideRooms.find(room => room.id === roomId);
  if (teachingRoom) {
    const xs = teachingRoom.ring.map(point => point[0]);
    const zs = teachingRoom.ring.map(point => point[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2 * WIDTH / LAYOUT_WIDTH, y,
      (Math.min(...zs) + Math.max(...zs)) / 2 * LENGTH / LAYOUT_LENGTH];
  }
  // Fit the survey coordinates to the simplified shell on the other floors.
  return [(east / 46.71 - .5) * WIDTH * .9, y, (.5 - north / 65.1) * LENGTH * .9];
}

export const lightingItems = csvRecords(inventoryCsv).flatMap(item => {
  const room = rooms.get(item.room_id);
  const floor = Number(item.floor);
  if (item.group !== 'lighting' || !room || floor < 0 || floor >= FLOOR_COUNT) return [];
  return [{
    id: item.item_id,
    floor,
    installed: item.option_id,
    position: markerPosition(item.room_id, floor, Number(room.centroid_x_m), Number(room.centroid_y_m)),
  }];
});

export function lightingScenario(draft: ReadonlyMap<number, string>): Scenario {
  return Array.from(draft, ([floor, option]) => ({ group: 'lighting', floor, option }));
}
