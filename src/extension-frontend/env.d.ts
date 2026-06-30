// Allow CSS file imports processed by esbuild
declare module '*.css';

// Monaco Environment is set on `self` inside a worker bundle
interface WorkerGlobalScope {
  MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
}
