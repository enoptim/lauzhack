/// <reference types="vite/client" />
import inventoryCsv from '../../../../data/inventory.csv?raw';
import optionsCsv from '../../../../data/options.csv?raw';
import roomsCsv from '../../../../data/rooms.csv?raw';
import { FLOOR_COUNT, FLOOR_HEIGHT, LAYOUT_LENGTH, LAYOUT_WIDTH, LENGTH, WIDTH } from '@/data/building';
import { sideRooms } from '@/data/sideRooms';
import type { Swap } from '@/api/types';

export const equipmentLabels = { lighting: 'Lighting', monitors: 'Monitors', computers: 'Computers', coffee: 'Coffee machines', water_heater: 'Water heaters', servers: 'Server racks', ventilation: 'Ventilation', solar_pv: 'Solar panels', blinds: 'Blinds', lauzhack_banner: 'LauzHack banner' };
export type EquipmentGroup = keyof typeof equipmentLabels;
export type EquipmentSwap = Swap & { group: EquipmentGroup };

export const isBuildingWide = (group: EquipmentGroup) =>
  group === 'water_heater' || group === 'ventilation' || group === 'solar_pv' || group === 'blinds';
export const draftKey = (floor: number | null, group: EquipmentGroup) => isBuildingWide(group) ? group : `${floor}:${group}`;

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

const options = csvRecords(optionsCsv);
const inventory = csvRecords(inventoryCsv);

export function equipmentForFloor(floor: number | null, group: EquipmentGroup) {
  const choices = options.filter(option => option.group === group);
  const installedIds = new Set(inventory.filter(item => item.group === group && (isBuildingWide(group) || Number(item.floor) === floor))
    .map(item => item.option_id));
  const installed = installedIds.size === 1
    ? choices.find(option => installedIds.has(option.option_id))
    : undefined;
  return { choices, installed };
}

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

export const lightingItems = inventory.flatMap(item => {
  const room = rooms.get(item.room_id);
  const floor = Number(item.floor);
  if (item.group !== 'lighting' || !room || floor < 0 || floor >= FLOOR_COUNT) return [];
  return [{
    id: item.item_id,
    floor,
    position: markerPosition(item.room_id, floor, Number(room.centroid_x_m), Number(room.centroid_y_m)),
  }];
});

