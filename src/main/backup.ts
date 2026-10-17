import { readFile, writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { getConfig, replaceConfig } from './config-store'
import type { AppConfig } from '../shared/types'

/**
 * 备份文件带上 app / version / exportedAt 三个外壳字段：
 * 用户三个月后翻出这个文件时，至少能看出它是哪来的、哪个版本的。
 * 导入时兼容「只有 config 对象」和「直接就是配置」两种写法。
 */
export async function exportConfigTo(filePath: string): Promise<string> {
  const payload = {
    app: 'countingdown',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    config: getConfig()
  }
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return filePath
}

export async function importConfigFrom(filePath: string): Promise<AppConfig> {
  const raw = await readFile(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  const candidate =
    parsed && typeof parsed === 'object' && 'config' in parsed
      ? (parsed as { config: unknown }).config
      : parsed

  // 只做最低限度的结构校验：别的字段都能靠 mergeConfig 兜底，但列表没了就没法用
  if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as AppConfig).countdowns)) {
    throw new Error('INVALID_CONFIG')
  }
  return replaceConfig(candidate)
}
