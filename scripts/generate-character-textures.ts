import sharp from "sharp";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const OUT_DIR = resolve("public/assets/textures/characters");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

async function generateTextures(): Promise<void> {
  // 1. Ziemek Face Texture (Stylized cartoon boy: big expressive eyes, brown eyebrows, confident friendly smile)
  const ziemekFaceSvg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#fcd5b5"/>
      <!-- Soft peach skin blush -->
      <circle cx="58" cy="155" r="22" fill="#f8a590" opacity="0.45"/>
      <circle cx="198" cy="155" r="22" fill="#f8a590" opacity="0.45"/>
      <!-- Expressive brown eyebrows -->
      <path d="M 46 82 Q 78 68 106 80" stroke="#4a2e1b" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M 210 82 Q 178 68 150 80" stroke="#4a2e1b" stroke-width="7" fill="none" stroke-linecap="round"/>
      <!-- Big anime eyes: outer white -->
      <ellipse cx="76" cy="120" rx="26" ry="34" fill="#ffffff"/>
      <ellipse cx="180" cy="120" rx="26" ry="34" fill="#ffffff"/>
      <!-- Deep warm brown iris -->
      <ellipse cx="76" cy="122" rx="20" ry="26" fill="#5c3826"/>
      <ellipse cx="180" cy="122" rx="20" ry="26" fill="#5c3826"/>
      <!-- Pupil & highlights -->
      <ellipse cx="76" cy="123" rx="12" ry="16" fill="#1b120c"/>
      <ellipse cx="180" cy="123" rx="12" ry="16" fill="#1b120c"/>
      <circle cx="68" cy="112" r="7" fill="#ffffff"/>
      <circle cx="172" cy="112" r="7" fill="#ffffff"/>
      <circle cx="84" cy="128" r="3.5" fill="#ffffff"/>
      <circle cx="188" cy="128" r="3.5" fill="#ffffff"/>
      <!-- Cute confident smile -->
      <path d="M 94 182 Q 128 206 162 182" stroke="#5c2918" stroke-width="6" fill="#8c3320" stroke-linecap="round"/>
      <path d="M 104 185 Q 128 194 152 185" fill="#ffffff"/>
    </svg>
  `;
  await sharp(Buffer.from(ziemekFaceSvg)).png().toFile(resolve(OUT_DIR, "ziemek_face.png"));

  // 2. Gniewko Face Texture (Younger brother: cheerful big open smile, bright wide eyes, sweet smile)
  const gniewkoFaceSvg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#fee0c6"/>
      <!-- Rosy cheeks -->
      <circle cx="52" cy="150" r="25" fill="#f89f8c" opacity="0.5"/>
      <circle cx="204" cy="150" r="25" fill="#f89f8c" opacity="0.5"/>
      <!-- Cheerful high eyebrows -->
      <path d="M 52 74 Q 82 58 108 72" stroke="#533522" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M 204 74 Q 174 58 148 72" stroke="#533522" stroke-width="6" fill="none" stroke-linecap="round"/>
      <!-- Wide round joyful eyes -->
      <circle cx="80" cy="115" r="28" fill="#ffffff"/>
      <circle cx="176" cy="115" r="28" fill="#ffffff"/>
      <!-- Rich amber-brown iris -->
      <circle cx="80" cy="116" r="21" fill="#6d442a"/>
      <circle cx="176" cy="116" r="21" fill="#6d442a"/>
      <!-- Pupil & sparkling highlights -->
      <circle cx="80" cy="117" r="13" fill="#1f140e"/>
      <circle cx="176" cy="117" r="13" fill="#1f140e"/>
      <circle cx="72" cy="108" r="8" fill="#ffffff"/>
      <circle cx="168" cy="108" r="8" fill="#ffffff"/>
      <circle cx="88" cy="124" r="4" fill="#ffffff"/>
      <circle cx="184" cy="124" r="4" fill="#ffffff"/>
      <!-- Open cheerful laughing mouth -->
      <path d="M 96 170 Q 128 220 160 170 Z" fill="#9e2a2b" stroke="#6b1d1e" stroke-width="4"/>
      <!-- Little tongue & teeth -->
      <path d="M 106 172 Q 128 178 150 172" stroke="#ffffff" stroke-width="5" fill="none"/>
      <path d="M 112 195 Q 128 185 144 195 Q 128 212 112 195 Z" fill="#f28482"/>
    </svg>
  `;
  await sharp(Buffer.from(gniewkoFaceSvg)).png().toFile(resolve(OUT_DIR, "gniewko_face.png"));

  // 3. Ziemek Hoodie Texture (Teal/Cyan pixel creeper pattern from concept art)
  const ziemekHoodieSvg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="pixelGrid" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#209889"/>
          <rect x="0" y="0" width="16" height="16" fill="#26a898"/>
          <rect x="16" y="16" width="16" height="16" fill="#1b8577"/>
          <rect x="4" y="4" width="8" height="8" fill="#3cd6c2" opacity="0.7"/>
          <rect x="20" y="20" width="8" height="8" fill="#146d61" opacity="0.6"/>
        </pattern>
      </defs>
      <rect width="256" height="256" fill="url(#pixelGrid)"/>
      <!-- Center Creeper pixel face motif -->
      <g transform="translate(96, 76) scale(2.0)">
        <rect x="4" y="4" width="7" height="7" fill="#134e45"/>
        <rect x="21" y="4" width="7" height="7" fill="#134e45"/>
        <rect x="11" y="11" width="10" height="11" fill="#134e45"/>
        <rect x="7" y="18" width="5" height="11" fill="#134e45"/>
        <rect x="20" y="18" width="5" height="11" fill="#134e45"/>
      </g>
      <!-- Drawstring cords -->
      <path d="M 100 24 L 98 120" stroke="#f1f5f9" stroke-width="5" stroke-linecap="round"/>
      <path d="M 156 24 L 158 120" stroke="#f1f5f9" stroke-width="5" stroke-linecap="round"/>
      <!-- Bottom ribbing -->
      <rect y="232" width="256" height="24" fill="#152024"/>
    </svg>
  `;
  await sharp(Buffer.from(ziemekHoodieSvg)).png().toFile(resolve(OUT_DIR, "ziemek_hoodie.png"));

  // 4. Gniewko Polo Shirt Texture (Crisp white polo with navy collar and buttons)
  const gniewkoPoloSvg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#f8fafc"/>
      <!-- Navy collar band -->
      <path d="M 64 0 L 128 48 L 192 0 L 224 0 L 128 68 L 32 0 Z" fill="#1e293b"/>
      <!-- Placket center placket -->
      <rect x="116" y="52" width="24" height="110" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2"/>
      <!-- Three wood/amber buttons -->
      <circle cx="128" cy="74" r="5" fill="#b45309" stroke="#78350f" stroke-width="1.5"/>
      <circle cx="128" cy="104" r="5" fill="#b45309" stroke="#78350f" stroke-width="1.5"/>
      <circle cx="128" cy="134" r="5" fill="#b45309" stroke="#78350f" stroke-width="1.5"/>
      <!-- Soft fabric shading -->
      <path d="M 0 0 L 0 256 L 24 256 L 16 0 Z" fill="#000000" opacity="0.04"/>
      <path d="M 256 0 L 256 256 L 232 256 L 240 0 Z" fill="#000000" opacity="0.04"/>
    </svg>
  `;
  await sharp(Buffer.from(gniewkoPoloSvg)).png().toFile(resolve(OUT_DIR, "gniewko_polo.png"));

  console.log("Generated stylized character textures successfully!");
}

void generateTextures();
