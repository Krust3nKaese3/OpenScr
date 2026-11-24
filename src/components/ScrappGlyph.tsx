import Ionicons from '@expo/vector-icons/Ionicons';

type Kind = 'moon' | 'note' | 'bolt' | 'die';

function kindFor(name: string): Kind {
  const lower = name.toLowerCase();
  if (lower.includes('wolf') || lower.includes('wer')) return 'moon';
  if (lower.includes('song') || lower.includes('musik') || lower.includes('spotify')) return 'note';
  if (lower.includes('macro')) return 'bolt';
  if (lower.includes('demo') || lower.includes('dice') || lower.includes('würf')) return 'die';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % 4;
  return (['moon', 'note', 'bolt', 'die'] as const)[hash];
}

const SCRAPP_ICONS = {
  moon: 'moon-outline',
  note: 'musical-note-outline',
  bolt: 'flash-outline',
  die: 'dice-outline',
} as const;

/** Outline icons from the same set as the navigation bar. */
export function ScrappGlyph({ name, color }: { name: string; color: string; card?: string }) {
  return <Ionicons name={SCRAPP_ICONS[kindFor(name)]} size={26} color={color} />;
}

const NAV_ICONS = {
  home: 'home-outline',
  qr: 'qr-code-outline',
  settings: 'settings-outline',
} as const;

export function NavGlyph({ name, color }: { name: keyof typeof NAV_ICONS; color: string }) {
  return <Ionicons name={NAV_ICONS[name]} size={22} color={color} />;
}
