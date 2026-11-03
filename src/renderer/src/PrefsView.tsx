import { useStore, type CsvFormat } from './store'

export function PrefsView() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const csvFormat = useStore((s) => s.csvFormat)
  const setCsvFormat = useStore((s) => s.setCsvFormat)
  return (
    <div className="comp-view">
      <div className="comp-body">
        <h2>Preferences</h2>
        <fieldset className="radios panel-card">
          <legend>Appearance</legend>
          <label><input type="radio" name="theme" checked={theme === 'light'} onChange={() => setTheme('light')} /> Light</label>
          <label><input type="radio" name="theme" checked={theme === 'dark'} onChange={() => setTheme('dark')} /> Dark</label>
        </fieldset>
        <fieldset className="radios panel-card">
          <legend>Numbers in exported CSV files</legend>
          {([['auto', 'Follow the language of this computer'], ['point', 'Decimal point, comma between columns (1,234.5)'], ['comma', 'Decimal comma, semicolon between columns (1234,5): Excel in Spanish']] as [CsvFormat, string][]).map(([v, t]) => (
            <label key={v}><input type="radio" name="csv" checked={csvFormat === v} onChange={() => setCsvFormat(v)} /> {t}</label>
          ))}
        </fieldset>
      </div>
    </div>
  )
}
