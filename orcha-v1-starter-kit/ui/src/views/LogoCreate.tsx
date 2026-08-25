import { OrchaMark } from '../components/OrchaMark'

export function LogoCreate() {
  return (
    <main className="logo-create">
      <a className="logo-create-back" href="/">Back</a>
      <div className="logo-create-stage">
        <OrchaMark size={112} />
        <h1>orcha</h1>
        <p>This is the mark. Tell me what to change and we will make it.</p>
      </div>
    </main>
  )
}
