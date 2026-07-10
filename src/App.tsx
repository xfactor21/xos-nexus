import { useState } from 'react';
import Boot from './components/Boot';
import Shell from './components/Shell';

function App() {
  const [booted, setBooted] = useState(false);

  return (
    <>
      {!booted && <Boot onDone={() => setBooted(true)} />}
      <Shell />
    </>
  );
}

export default App;
