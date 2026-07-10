import { useUiStore } from '../stores/uiStore';
import Observatory from '../modules/observatory';
import NeuralCore from '../modules/copilot/NeuralCore';
import Capture from '../modules/capture';
import Projects from '../modules/projects';
import Focus from '../modules/focus';
import Studio from '../modules/studio';
import Roadmaps from '../modules/roadmaps';
import Bugs from '../modules/bugs';
import Releases from '../modules/releases';
import Vault from '../modules/vault';
import Comms from '../modules/comms';
import Settings from '../modules/settings';

/** Every room mounts simultaneously and toggles the `.room.on` class, exactly
 * like the prototype's `go(r)` — this preserves per-room animation/canvas
 * state across navigation instead of unmounting (Observatory's starfield and
 * the Neural Core blob keep their RAF loops running the same way). */
export default function RoomOutlet() {
  const room = useUiStore((s) => s.room);
  return (
    <>
      <Observatory active={room === 'obs'} />
      <NeuralCore active={room === 'core'} />
      <Capture active={room === 'capture'} />
      <Projects active={room === 'projects'} />
      <Focus active={room === 'focus'} />
      <Studio active={room === 'studio'} />
      <Roadmaps active={room === 'roadmaps'} />
      <Bugs active={room === 'bugs'} />
      <Releases active={room === 'releases'} />
      <Vault active={room === 'vault'} />
      <Comms active={room === 'comms'} />
      <Settings active={room === 'settings'} />
    </>
  );
}
