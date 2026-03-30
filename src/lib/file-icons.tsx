import {
  BookOpen,
  Braces,
  FileCode2,
  FileText,
  Globe,
  Image,
  Lock,
  Palette,
  Settings,
  Terminal,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

export type FileIconResult = {
  icon: ReactNode
  color: string
}

type FileIconRule = {
  extensions?: string[]
  exactNames?: string[]
  prefixNames?: string[]
  icon: ComponentType<{ size: number }>
  color: string
}

const FILE_ICON_RULES: FileIconRule[] = [
  {
    exactNames: ['.gitignore', '.eslintrc', '.prettierrc'],
    icon: Settings,
    color: '#737373',
  },
  {
    prefixNames: ['.env', '.env.local', '.env.'],
    icon: Lock,
    color: '#F59E0B',
  },
  {
    extensions: ['ts', 'tsx'],
    icon: FileCode2,
    color: '#3178C6',
  },
  {
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    icon: FileCode2,
    color: '#F7DF1E',
  },
  {
    extensions: ['css', 'scss', 'sass'],
    icon: Palette,
    color: '#E34F26',
  },
  {
    extensions: ['html'],
    icon: Globe,
    color: '#E34F26',
  },
  {
    extensions: ['json', 'jsonc'],
    icon: Braces,
    color: '#A3A3A3',
  },
  {
    extensions: ['md', 'mdx'],
    icon: BookOpen,
    color: '#A3A3A3',
  },
  {
    extensions: ['py'],
    icon: FileCode2,
    color: '#3776AB',
  },
  {
    extensions: ['rs'],
    icon: FileCode2,
    color: '#DEA584',
  },
  {
    extensions: ['go'],
    icon: FileCode2,
    color: '#00ADD8',
  },
  {
    extensions: ['svg'],
    icon: Image,
    color: '#FFB13B',
  },
  {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'],
    icon: Image,
    color: '#A3A3A3',
  },
  {
    extensions: ['yaml', 'yml', 'toml'],
    icon: FileText,
    color: '#A3A3A3',
  },
  {
    extensions: ['sh', 'bash', 'zsh'],
    icon: Terminal,
    color: '#22C55E',
  },
]

function matchesFileIconRule(filename: string, rule: FileIconRule) {
  if (rule.exactNames?.includes(filename)) {
    return true
  }
  if (rule.prefixNames?.some(prefix => filename.startsWith(prefix))) {
    return true
  }
  if (rule.extensions?.length) {
    const dotIndex = filename.lastIndexOf('.')
    const extension = dotIndex >= 0 && dotIndex < filename.length - 1 ? filename.slice(dotIndex + 1) : ''
    return rule.extensions.includes(extension)
  }
  return false
}

export function getFileIcon(filename: string): FileIconResult {
  const lower = filename.toLowerCase()
  for (const rule of FILE_ICON_RULES) {
    if (matchesFileIconRule(lower, rule)) {
      const Icon = rule.icon
      return { icon: <Icon size={14} />, color: rule.color }
    }
  }

  return { icon: <FileText size={14} />, color: '#737373' }
}
