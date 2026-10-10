import base from '@fenwira/config/eslint'
import globals from 'globals'

export default [...base, { languageOptions: { globals: { ...globals.browser } } }]
