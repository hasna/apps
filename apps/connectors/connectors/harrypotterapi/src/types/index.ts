export interface HarryPotterConfig { baseUrl?: string; }

export interface HPCharacter { id: string; name: string; alternate_names: string[]; species: string; gender: string; house: string; dateOfBirth: string; yearOfBirth: number; wizard: boolean; ancestry: string; eyeColour: string; hairColour: string; wand: { wood: string; core: string; length: number | null }; patronus: string; hogwartsStudent: boolean; hogwartsStaff: boolean; actor: string; alive: boolean; image: string; }
export interface HPSpell { id: string; name: string; description: string; }

export class HarryPotterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HarryPotterApiError'; this.statusCode = statusCode; }
}
