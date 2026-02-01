import { useState, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { API_URL } from './api.js'
import { FaReact, FaNodeJs, FaCheck, FaRocket, FaSpinner } from 'react-icons/fa'
import { SiVite, SiTailwindcss, SiShadcnui, SiExpress, SiMongodb } from 'react-icons/si'
import { HiOutlineServerStack, HiOutlineCommandLine, HiSparkles, HiExclamationTriangle, HiXMark } from 'react-icons/hi2'

function App() {
  const [isApiConnected, setIsApiConnected] = useState(false)
  const [mongoStatus, setMongoStatus] = useState('checking...')
  const [mongoEnvMissing, setMongoEnvMissing] = useState(false)
  const [isMongoConnected, setIsMongoConnected] = useState(false)
  const [testingBackend, setTestingBackend] = useState(false)
  const [backendTestResult, setBackendTestResult] = useState(null)
  const [testingMongo, setTestingMongo] = useState(false)
  const [mongoTestResult, setMongoTestResult] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then(res => res.json())
      .then(data => {
        setIsApiConnected(true)
        if (data.mongoEnvMissing) {
          setMongoEnvMissing(true)
          setMongoStatus('ENV Missing')
          setIsMongoConnected(false)
        } else if (data.mongodb === 'connected') {
          setMongoStatus('Connected')
          setIsMongoConnected(true)
        } else {
          setMongoStatus('Not Connected')
          setIsMongoConnected(false)
        }
      })
      .catch(() => {
        setIsApiConnected(false)
        setMongoStatus('Unknown')
      })
  }, [])

  const handleTestBackend = async () => {
    setTestingBackend(true)
    setBackendTestResult(null)
    try {
      const res = await fetch(`${API_URL}/api/test-backend`)
      const data = await res.json()
      setBackendTestResult({ success: true, message: data.message })
      setTimeout(() => setBackendTestResult(null), 3000)
    } catch {
      setBackendTestResult({ success: false, message: 'Failed to connect to backend' })
      setTimeout(() => setBackendTestResult(null), 3000)
    }
    setTestingBackend(false)
  }

  const handleTestMongo = async () => {
    setTestingMongo(true)
    setMongoTestResult(null)
    try {
      const res = await fetch(`${API_URL}/api/test-mongodb`)
      const data = await res.json()
      setMongoTestResult({ success: data.connected, message: data.message })
      setTimeout(() => setMongoTestResult(null), 3000)
    } catch {
      setMongoTestResult({ success: false, message: 'Failed to test MongoDB connection' })
      setTimeout(() => setMongoTestResult(null), 3000)
    }
    setTestingMongo(false)
  }

  const frontendStack = [
    { name: 'React', icon: FaReact, color: 'text-cyan-400' },
    { name: 'Vite', icon: SiVite, color: 'text-amber-400' },
    { name: 'Tailwind CSS', icon: SiTailwindcss, color: 'text-sky-400' },
    { name: 'shadcn/ui', icon: SiShadcnui, color: 'text-zinc-100' },
    { name: 'React Icons', icon: HiSparkles, color: 'text-amber-300' },
  ]

  const backendStack = [
    { name: 'Node.js', icon: FaNodeJs, color: 'text-green-500' },
    { name: 'Express', icon: SiExpress, color: 'text-gray-300' },
    { name: 'MongoDB', icon: SiMongodb, color: 'text-green-400' },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <div className="flex justify-center mb-6">
            <img
              src="/assets/images/codedeck.png"
              alt="CodeDeck Logo"
              className="h-16 sm:h-20 w-auto drop-shadow-[0_0_30px_rgba(86,50,157,0.35)]"
            />
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-zinc-50 mb-2 tracking-tight">
            CodeDeck FullStack Template
          </h1>
          <p className="text-base sm:text-lg text-zinc-400">Your foundation for building amazing applications</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <Card className="bg-zinc-900/80 border-zinc-800/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-zinc-50">
                <div className="p-2 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
                  <HiOutlineCommandLine className="w-5 h-5 text-violet-400" />
                </div>
                Frontend Stack
              </CardTitle>
              <CardDescription className="text-zinc-500">
                Modern React development setup
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {frontendStack.map((tech) => (
                  <div
                    key={tech.name}
                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/30 transition-colors hover:bg-zinc-800/60"
                  >
                    <div className="flex items-center gap-3">
                      <tech.icon className={`w-5 h-5 ${tech.color}`} />
                      <span className="text-zinc-200 font-medium">{tech.name}</span>
                    </div>
                    <FaCheck className="w-4 h-4 text-violet-400" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/80 border-zinc-800/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-zinc-50">
                <div className="p-2 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
                  <HiOutlineServerStack className="w-5 h-5 text-violet-400" />
                </div>
                Backend Stack
              </CardTitle>
              <CardDescription className="text-zinc-500">
                Express + MongoDB connection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {backendStack.map((tech) => (
                  <div
                    key={tech.name}
                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/30 transition-colors hover:bg-zinc-800/60"
                  >
                    <div className="flex items-center gap-3">
                      <tech.icon className={`w-5 h-5 ${tech.color}`} />
                      <span className="text-zinc-200 font-medium">{tech.name}</span>
                    </div>
                    <FaCheck className="w-4 h-4 text-violet-400" />
                  </div>
                ))}

                <div className="pt-3 mt-3 border-t border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/30">
                    <span className="text-zinc-500 text-sm">API Server</span>
                    <span className={`text-sm font-medium flex items-center gap-2 ${isApiConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isApiConnected ? (
                        <><FaCheck className="w-3 h-3" /> Connected</>
                      ) : (
                        <><HiXMark className="w-4 h-4" /> Not Running</>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/30">
                    <span className="text-zinc-500 text-sm">MongoDB</span>
                    {mongoEnvMissing ? (
                      <span className="text-sm font-medium text-amber-400 flex items-center gap-2">
                        <HiExclamationTriangle className="w-4 h-4" />
                        <span className="text-xs">ENV Missing</span>
                      </span>
                    ) : (
                      <span className={`text-sm font-medium flex items-center gap-2 ${isMongoConnected ? 'text-emerald-400' : isApiConnected ? 'text-red-400' : 'text-zinc-600'}`}>
                        {isMongoConnected ? (
                          <><FaCheck className="w-3 h-3" /> Connected</>
                        ) : isApiConnected ? (
                          <><HiXMark className="w-4 h-4" /> {mongoStatus}</>
                        ) : (
                          <><FaSpinner className="w-3 h-3 animate-spin" /> Pending</>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-3 space-y-2">
                  {backendTestResult ? (
                    <div className={`text-sm px-5 rounded-xl border h-10 flex items-center justify-center ${backendTestResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                      <div className="flex items-center gap-2">
                        {backendTestResult.success ? <FaCheck className="w-3 h-3" /> : <HiXMark className="w-4 h-4" />}
                        {backendTestResult.message}
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 rounded-xl transition-all h-10"
                      variant="outline"
                      onClick={handleTestBackend}
                      disabled={testingBackend}
                    >
                      {testingBackend ? (
                        <><FaSpinner className="w-4 h-4 mr-2 animate-spin" /> Testing...</>
                      ) : (
                        'Test Backend'
                      )}
                    </Button>
                  )}

                  {!mongoEnvMissing && (
                    <>
                      {mongoTestResult ? (
                        <div className={`text-sm px-5 rounded-xl border h-10 flex items-center justify-center ${mongoTestResult.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                          <div className="flex items-center gap-2">
                            {mongoTestResult.success ? <FaCheck className="w-3 h-3" /> : <HiXMark className="w-4 h-4" />}
                            {mongoTestResult.message}
                          </div>
                        </div>
                      ) : (
                        <Button
                          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 rounded-xl transition-all h-10"
                          variant="outline"
                          onClick={handleTestMongo}
                          disabled={testingMongo || !isApiConnected}
                        >
                          {testingMongo ? (
                            <><FaSpinner className="w-4 h-4 mr-2 animate-spin" /> Testing...</>
                          ) : (
                            'Test MongoDB'
                          )}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4 sm:mt-6 bg-zinc-900/80 border-zinc-800/50 backdrop-blur-xl">
          <CardContent className="pt-6">
            <div className="text-center py-4 sm:py-6">
              <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-zinc-800/60 ring-1 ring-zinc-700/50 mb-4">
                <img
                  src="/assets/images/railway.svg"
                  alt="Railway"
                  className="w-10 h-10 sm:w-12 sm:h-12"
                />
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-zinc-50 mb-3">1-Click Deploy to Railway</h3>
              <p className="text-zinc-400 text-sm sm:text-base max-w-lg mx-auto mb-4">
                This template is pre-configured for Railway deployment. When you're ready, deploy your full-stack application with a single click.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4 sm:mt-6 bg-zinc-900/80 border-zinc-800/50 backdrop-blur-xl">
          <CardContent className="pt-6">
            <div className="text-center py-4 sm:py-6">
              <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 mb-4">
                <FaRocket className="w-6 h-6 sm:w-8 sm:h-8 text-violet-400" />
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-zinc-50 mb-3">Next Step</h3>
              <p className="text-zinc-300 text-sm sm:text-base max-w-lg mx-auto leading-relaxed">
                Ask Claude to remove this page and start building something amazing.
                Your full-stack foundation is ready — now it's time to bring your ideas to life.
              </p>
              <p className="text-zinc-500 mt-4 sm:mt-6 text-xs sm:text-sm">
                Happy vibe coding and Happy Shipping!
              </p>
              <p className="text-zinc-600 mt-3 sm:mt-4 text-xs sm:text-sm">
                Bruno Bertapeli,
                <br />
                <span className="text-violet-400 font-medium">CodeDeck</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
