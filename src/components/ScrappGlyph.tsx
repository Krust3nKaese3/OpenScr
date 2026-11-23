import React from 'react';
import { View } from 'react-native';

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

/** Lime line icons. The card color cuts the moon so the crescent stays on the tile. */
export function ScrappGlyph({ name, color, card }: { name: string; color: string; card: string }) {
  const kind = kindFor(name);
  if (kind === 'moon') {
    return (
      <View style={{ width: 28, height: 28 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color, marginTop: 3 }} />
        <View style={{ position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: card, right: 0, top: 1 }} />
      </View>
    );
  }
  if (kind === 'note') {
    return (
      <View style={{ width: 28, height: 28 }}>
        <View style={{ position: 'absolute', left: 16, top: 2, width: 2, height: 16, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: 16, top: 2, width: 10, height: 2, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: 8, top: 16, width: 10, height: 8, borderRadius: 5, borderWidth: 2, borderColor: color }} />
      </View>
    );
  }
  if (kind === 'bolt') {
    return (
      <View style={{ width: 28, height: 28 }}>
        <View style={{ position: 'absolute', left: 12, top: 2, width: 8, height: 12, backgroundColor: color, transform: [{ skewX: '-18deg' }] }} />
        <View style={{ position: 'absolute', left: 8, top: 12, width: 8, height: 12, backgroundColor: color, transform: [{ skewX: '-18deg' }] }} />
      </View>
    );
  }
  return (
    <View style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: color, padding: 3, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {[0, 1, 2, 3].map((dot) => (
        <View key={dot} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color, margin: 2 }} />
      ))}
    </View>
  );
}

export function NavGlyph({ name, color }: { name: 'home' | 'qr' | 'settings'; color: string }) {
  if (name === 'home') {
    return (
      <View style={{ width: 22, height: 18, alignItems: 'center' }}>
        <View style={{ width: 14, height: 14, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '45deg' }], marginTop: 6 }} />
        <View style={{ position: 'absolute', bottom: 0, width: 12, height: 8, borderWidth: 2, borderColor: color, borderTopWidth: 0 }} />
      </View>
    );
  }
  if (name === 'qr') {
    return (
      <View style={{ width: 20, height: 20 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, width: 7, height: 7, borderWidth: 2, borderColor: color }} />
        <View style={{ position: 'absolute', right: 0, top: 0, width: 7, height: 7, borderWidth: 2, borderColor: color }} />
        <View style={{ position: 'absolute', left: 0, bottom: 0, width: 7, height: 7, borderWidth: 2, borderColor: color }} />
        <View style={{ position: 'absolute', right: 2, bottom: 2, width: 4, height: 4, backgroundColor: color }} />
      </View>
    );
  }
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: color }} />
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute',
            width: 2,
            height: 5,
            backgroundColor: color,
            top: 0,
            transform: [{ rotate: `${deg}deg` }, { translateY: -1 }],
          }}
        />
      ))}
    </View>
  );
}
