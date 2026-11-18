/*
 * Lists and clears flight logs (tlog, bin, kmz) and media files
 */

const path = require('path')
const fs = require('fs')
const logpaths = require('./paths.js')

const MEDIA_EXTENSIONS = ['.jpg', '.png', '.gif', '.avi', '.mp4', '.h264', '.h265']

class flightLogger {
  constructor () {
    this.tlogfolder = logpaths.tlogDir
    this.binlogfolder = logpaths.binDir
    this.kmzlogfolder = logpaths.kmzDir
    this.mediafolder = logpaths.mediaDir

    const folders = [this.tlogfolder, this.binlogfolder, this.kmzlogfolder, this.mediafolder]
    if (logpaths.terminalLogDir) {
      folders.push(logpaths.terminalLogDir)
    }
    folders.forEach((folder) => fs.mkdirSync(folder, { recursive: true }))
  }

  // Delete files of one type, skipping the absolute paths in activeFiles.
  // The type's top folder is kept. Returns { deleted, skipped }.
  clearlogs (logtype, activeFiles = []) {
    const active = new Set((activeFiles || []).filter(Boolean).map((f) => path.resolve(f)))
    const result = { deleted: 0, skipped: 0 }

    const clearDir = (dir, matcher) => {
      let entries
      try {
        entries = fs.readdirSync(dir)
      } catch (e) {
        if (e.code === 'ENOENT') {
          return
        }
        throw e
      }
      entries.forEach((entry) => {
        const entryPath = path.join(dir, entry)
        const stat = fs.lstatSync(entryPath)
        if (stat.isDirectory()) {
          clearDir(entryPath, matcher)
          try {
            fs.rmdirSync(entryPath)
          } catch (e) {
            // not empty
          }
        } else if (matcher(entryPath)) {
          if (active.has(path.resolve(entryPath))) {
            result.skipped++
          } else {
            fs.unlinkSync(entryPath)
            result.deleted++
          }
        }
      })
    }

    const byExtension = (ext) => (filePath) => filePath.toLowerCase().endsWith(ext)
    const anyFile = () => true

    if (logtype === 'tlog') {
      clearDir(this.tlogfolder, byExtension('.tlog'))
    } else if (logtype === 'binlog') {
      clearDir(this.binlogfolder, byExtension('.bin'))
    } else if (logtype === 'kmzlog') {
      clearDir(this.kmzlogfolder, anyFile)
    } else if (logtype === 'media') {
      clearDir(this.mediafolder, anyFile)
    }
    console.log(`Cleared ${logtype}: deleted ${result.deleted}, kept ${result.skipped}`)
    return result
  }

  // find all files in dir (recursively); keys are relative to dir
  findInDir (dir, extfilter) {
    const fileList = []
    const extensions = Array.isArray(extfilter) ? extfilter : [extfilter]

    function scanDirectory (currentDir) {
      let files
      try {
        files = fs.readdirSync(currentDir)
      } catch (e) {
        if (e.code === 'ENOENT') {
          return
        }
        throw e
      }

      files.forEach((file) => {
        const filePath = path.join(currentDir, file)
        const fileStat = fs.lstatSync(filePath)
        const filemTime = new Date(fileStat.mtimeMs)

        if (fileStat.isDirectory()) {
          scanDirectory(filePath)
        } else if (extensions.some(ext => filePath.toLowerCase().endsWith(ext.toLowerCase()))) {
          const relpath = path.relative(dir, filePath)
          const mTime = filemTime.toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          fileList.push({ key: relpath, name: path.basename(filePath), modified: mTime, size: Math.round(fileStat.size / 1024) })
        }
      })
    }

    scanDirectory(dir)
    return fileList
  }

  // get list of logfiles for website
  // return format is (err, tlogs, binlogs, kmzlogs, media)
  getLogs (callback) {
    const newfilestlog = this.findInDir(this.tlogfolder, '.tlog')
    const newfilesbinlog = this.findInDir(this.binlogfolder, '.bin')
    const newfileskmzlog = this.findInDir(this.kmzlogfolder, '.kmz')
    const newfilesmedia = this.findInDir(this.mediafolder, MEDIA_EXTENSIONS)

    return callback(false, newfilestlog, newfilesbinlog, newfileskmzlog, newfilesmedia)
  };
}

module.exports = flightLogger
