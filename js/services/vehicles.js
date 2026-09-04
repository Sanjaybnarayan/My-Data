/**
 * What the vehicle records say when read together.
 *
 * The assembly is here rather than in the screen for the usual reason, and one
 * specific to this project's ratchets: the UI→database budget is at its limit
 * and may only narrow, so a screen that fetched fuel logs itself could not be
 * written.
 */

import { Service } from './service.js';
import { mileage } from '../domain/fuel.js';

/** @type {Record<string, import('./service.js').Load>} */
export const VEHICLES_LOAD = Object.freeze({
  vehicles: ['vehicle', { decrypt: false }],
  fuelLogs: ['fuelLog', { decrypt: false, limit: 2000 }],
});

/**
 * @param {Record<string, object[]>} data as `VEHICLES_LOAD` yields
 */
export function assembleVehicles(data) {
  const { vehicles = [], fuelLogs = [] } = data ?? {};
  // The spread comes first on purpose: `mileage` returns its own `vehicle`
  // key holding the *id*, and spreading it last replaced the vehicle record
  // with that string. Every row then rendered as "Vehicle" with a broken
  // link, and the browser check passed anyway because it only looked for
  // "km/l". The type checker found it; the test had not.
  const rows = vehicles
    .filter((one) => one && !one.deletedAt)
    .map((vehicle) => ({ ...mileage(vehicle.id, fuelLogs), vehicle }));

  return {
    rows,
    any: rows.some((row) => row.kmPerLitre !== null || row.fills > 0),
    /** Vehicles with fills recorded but no figure yet, and the reason. */
    unmeasured: rows.filter((row) => row.kmPerLitre === null && row.fills > 0),
  };
}

export class VehiclesService extends Service {
  async mileage() {
    return assembleVehicles(await this.load(VEHICLES_LOAD));
  }
}
