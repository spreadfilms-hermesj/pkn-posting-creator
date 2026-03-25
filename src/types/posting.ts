export interface AIEditableField {
  type: 'text' | 'graphic'
  layerName: string      // e.g. "Headline" (the * or ! is stripped)
  isImageSlot?: boolean  // true for !-prefixed layers (editable image placeholder)
  isDecorativeLayer?: boolean  // true for #-prefixed layers — rendered on canvas, hidden in sidebar
  // text fields
  value: string
  originalText: string
  fontSize: number       // in artboard native px
  color: string
  fontWeight: number          // CSS numeric weight: 100 Thin … 400 Regular … 700 Bold … 900 Black
  fontStyle: 'normal' | 'italic'
  textAlign: 'left' | 'center' | 'right'
  // graphic fields
  imageUrl?: string      // extracted graphic as PNG data URL
  scale: number          // horizontal scale multiplier (1 = original size)
  scaleY?: number        // vertical scale — if undefined, same as scale (proportional)
  imageOffsetX?: number  // horizontal pan offset in artboard px (image slots only, default 0 = centered)
  // shared positioning (normalized 0–1)
  x: number
  y: number
  width: number
  height: number
  // shared appearance
  opacity: number        // 0–1, default 1
  // transform anchor (normalized 0–1 canvas coords) — center of visible content within the full-artboard PNG
  contentCenterX?: number  // default 0.5
  contentCenterY?: number  // default 0.5
}

export interface AIImportData {
  backgroundImageUrl: string  // artboard rendered without * layers
  thumbnailUrl?: string       // composite of background + all graphic layers (for variant switcher)
  artboardWidth: number
  artboardHeight: number
  artboardName: string
  editableFields: AIEditableField[]
}

export interface AIImportVariants {
  variants: AIImportData[]
  activeVariantIndex: number
}

export interface TemplateGroup {
  baseName: string        // e.g. "01_Posting" (format suffix stripped)
  variants: AIImportData[] // all artboards for this template
}

export interface ProjectDraft {
  id: string                        // unique ID
  name: string                      // user-provided name
  createdAt: string                 // ISO date string
  aiImport: AIImportData            // snapshot of aiImport with all edits
  aiImportVariants: AIImportVariants | null
  format: Format
  templateBaseName?: string         // which template this is based on
}

export interface BrandSettings {
  logo: string | null
  logoText: string
  primaryColor: string
  secondaryColor: string
  fontFamily: 'Vazirmatn' | 'Segoe UI' | 'Inter'
  logoSize: 'small' | 'medium' | 'large'
  logoBackground: boolean
  logoColor: 'original' | 'white' | 'black' | 'primary'
}

export type PostType =
  | 'event'
  | 'announcement'
  | 'pure-visual'
  | 'quote'
  | 'stat'
  | 'service'
  | 'hiring'
  | 'reminder'
  | 'presentation'
  | 'carousel'

export type Format = '1:1' | '4:3' | '3:4' | '4:5' | '16:9' | '9:16' | '4:1'

export interface CarouselSlide {
  id: string
  slideType: Exclude<PostType, 'carousel'>
  image: string | null
  backgroundGradient: string | null
  headline: string
  subline: string
  pillLabel: string
  ctaLabel: string
  metaLine: string
  featuredImage: string | null
}

export interface PostingConfig {
  // Media
  image: string | null
  backgroundGradient: string | null
  featuredImage: string | null
  imageDarken: number
  spaceBackgroundEnabled: boolean

  // Carousel
  carouselSlides: CarouselSlide[]
  currentSlideIndex: number

  // Post Type & Content
  postType: PostType
  headline: string
  subline: string
  pillLabel: string
  ctaLabel: string
  metaLine: string
  stat1Value: string
  stat1Label: string
  stat2Value: string
  stat2Label: string
  stat3Value: string
  stat3Label: string
  highlightWord: string

  // Brand Controls
  logoEnabled: boolean
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  pillEnabled: boolean
  ctaMode: 'off' | 'primary' | 'secondary'
  statsMode: 'off' | 'one' | 'three'
  highlightEnabled: boolean
  backgroundDensity: 'low' | 'medium' | 'high'
  glowIntensity: 'low' | 'medium' | 'high'

  // Format
  format: Format

  // Brand Settings
  brandSettings: BrandSettings

  // AI Import
  aiImport: AIImportData | null
  aiImportVariants: AIImportVariants | null
}

export const defaultBrandSettings: BrandSettings = {
  logo: null,
  logoText: 'PKN',
  primaryColor: '#01AAD5',
  secondaryColor: '#1D1D1B',
  fontFamily: 'Vazirmatn',
  logoSize: 'medium',
  logoBackground: true,
  logoColor: 'primary',
}

export const defaultConfig: PostingConfig = {
  image: null,
  backgroundGradient: null,
  featuredImage: null,
  imageDarken: 30,
  spaceBackgroundEnabled: true,
  postType: 'event',
  headline: 'IT KOSMOS Conference 2026',
  subline: 'Join the Mission to the Future of Technology',
  pillLabel: 'Event',
  ctaLabel: 'Jetzt anmelden',
  metaLine: '15. März 2026 · Vienna Space Center',
  stat1Value: '500+',
  stat1Label: 'Participants',
  stat2Value: '50+',
  stat2Label: 'Speakers',
  stat3Value: '3',
  stat3Label: 'Days',
  highlightWord: 'IT KOSMOS',
  logoEnabled: true,
  logoPosition: 'top-left',
  pillEnabled: true,
  ctaMode: 'primary',
  statsMode: 'off',
  highlightEnabled: true,
  backgroundDensity: 'medium',
  glowIntensity: 'medium',
  format: '1:1',
  brandSettings: defaultBrandSettings,
  carouselSlides: [],
  currentSlideIndex: 0,
  aiImport: null,
  aiImportVariants: null,
}

export const FORMAT_DIMENSIONS: Record<Format, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1200, height: 900 },
  '3:4': { width: 900, height: 1200 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:1': { width: 2804, height: 701 },
}
