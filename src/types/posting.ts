export interface AIEditableField {
  type: 'text' | 'graphic'
  layerName: string      // e.g. "Headline" (the * is stripped)
  // text fields
  value: string
  originalText: string
  fontSize: number       // in artboard native px
  color: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  textAlign: 'left' | 'center' | 'right'
  // graphic fields
  imageUrl?: string      // extracted graphic as PNG data URL
  scale: number          // scale multiplier (1 = original size)
  // shared positioning (normalized 0–1)
  x: number
  y: number
  width: number
  height: number
}

export interface AIImportData {
  backgroundImageUrl: string  // artboard rendered without * layers
  artboardWidth: number
  artboardHeight: number
  artboardName: string
  editableFields: AIEditableField[]
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

export type Format = '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

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
}

export const FORMAT_DIMENSIONS: Record<Format, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1200, height: 900 },
  '3:4': { width: 900, height: 1200 },
  '16:9': { width: 1200, height: 675 },
  '9:16': { width: 1080, height: 1920 },
}
