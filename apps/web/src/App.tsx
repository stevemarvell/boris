import {
  IonApp,
  IonContent,
  IonHeader,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  setupIonicReact,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { fetchStatus } from './api';

setupIonicReact();

type Connection = { state: 'loading' } | { state: 'up' } | { state: 'down'; reason: string };

export function App() {
  const [connection, setConnection] = useState<Connection>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then(() => {
        if (!cancelled) setConnection({ state: 'up' });
      })
      .catch((err: Error) => {
        if (!cancelled) setConnection({ state: 'down', reason: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Family Tree</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <h2>Step 0</h2>
          <p>
            Nothing here yet but the pipeline. This page is deployed on Vercel and is asking the
            API on Railway whether it is alive.
          </p>
        </IonText>
        <IonNote data-testid="api-status">
          {connection.state === 'loading' && (
            <>
              <IonSpinner name="dots" /> checking the API…
            </>
          )}
          {connection.state === 'up' && 'API reachable.'}
          {connection.state === 'down' && `API unreachable — ${connection.reason}`}
        </IonNote>
      </IonContent>
    </IonApp>
  );
}
