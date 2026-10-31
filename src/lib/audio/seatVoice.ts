import { characterVoice, speakCall, speakPass, type CharacterVoice } from "./characterVoice";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";

/**
 * Character voices for 2D/3D game boards that only know a seat and the name shown on it:
 * the voice of the character that player chose (프로필 → 캐릭터, shared through the room's
 * presence — see roomCharacters.ts), else the seat's own voice. Same voice the 3D table gives
 * them, so a player sounds like themself in every game.
 */
export function seatVoice(seat: number, name: string | null | undefined): CharacterVoice {
  return characterVoice(seat, roomCharacterOf(useRoomCharacters.getState().byName, name));
}

/** `seat` calls out `word` ("코요테", "페루도" …) in their character's voice. */
export function callAs(seat: number, name: string | null | undefined, word: string) {
  speakCall(seatVoice(seat, name), word);
}

/** `seat` passes in their character's voice. */
export function passAs(seat: number, name: string | null | undefined) {
  speakPass(seat, seatVoice(seat, name));
}
