import type { ConductorType } from '../types';
import { EVERYDAY_STRESS_RATIO } from '../physics/constants';

/** 常用导线/地线型号库 (GB/T 1179 典型值) */
export const CONDUCTOR_LIBRARY: ConductorType[] = [
  {
    id: 'lgj-400-35',
    name: 'LGJ-400/35',
    kind: 'phase',
    area: 425.24,
    diameter: 26.82,
    unitWeight: 1.349,
    elasticModulus: 65000,
    expansionCoeff: 2.05e-5,
    ratedStrength: 103900,
  },
  {
    id: 'lgj-300-40',
    name: 'LGJ-300/40',
    kind: 'phase',
    area: 338.99,
    diameter: 23.94,
    unitWeight: 1.133,
    elasticModulus: 73000,
    expansionCoeff: 1.96e-5,
    ratedStrength: 92220,
  },
  {
    id: 'lgj-240-30',
    name: 'LGJ-240/30',
    kind: 'phase',
    area: 275.96,
    diameter: 21.6,
    unitWeight: 0.9222,
    elasticModulus: 73000,
    expansionCoeff: 1.96e-5,
    ratedStrength: 75620,
  },
  {
    id: 'gjlb-150',
    name: 'GJ-100 镀锌钢绞线',
    kind: 'ground',
    area: 100.88,
    diameter: 13.0,
    unitWeight: 0.803,
    elasticModulus: 181400,
    expansionCoeff: 1.15e-5,
    ratedStrength: 113800,
  },
  {
    id: 'opgw-100',
    name: 'OPGW-100 光纤复合架空地线',
    kind: 'ground',
    area: 98.6,
    diameter: 13.2,
    unitWeight: 0.652,
    elasticModulus: 147000,
    expansionCoeff: 1.3e-5,
    ratedStrength: 86000,
  },
];

export function everydayStress(c: ConductorType): number {
  return (EVERYDAY_STRESS_RATIO * c.ratedStrength) / c.area;
}
