import 'server-only'

/** /dev/ui component gallery (runtime flag; used by e2e accessibility tests). Off in production. */
export const uiGalleryEnabled = (): boolean => process.env.ENABLE_UI_GALLERY === 'true'
