import {
  IonApp,
  IonContent,
  IonHeader,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  setupIonicReact,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { PersonCard } from './PersonCard';
import { fetchGenerations } from './api';
import type { Generation } from './api';

setupIonicReact();

type State =
  | { status: 'loading' }
  | { status: 'ready'; generations: Generation[] }
  | { status: 'failed'; reason: string };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchGenerations()
      .then((generations) => {
        if (!cancelled) setState({ status: 'ready', generations });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'failed', reason: err.message });
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
      <IonContent>
        {state.status === 'loading' && (
          <div className="centred" data-testid="loading">
            <IonSpinner name="dots" />
          </div>
        )}

        {state.status === 'failed' && (
          <div className="centred" data-testid="error">
            <IonText color="danger">
              <p>Could not load the family tree — {state.reason}</p>
            </IonText>
          </div>
        )}

        {state.status === 'ready' && (
          <IonList>
            {state.generations.map((generation) => (
              <IonItemGroup key={generation.depth} data-testid="generation">
                <IonItemDivider sticky>
                  <IonLabel>
                    Generation {generation.depth + 1}
                    <span className="count"> · {generation.people.length} people</span>
                  </IonLabel>
                </IonItemDivider>
                {generation.people.map((person) => (
                  <PersonCard key={person.id} person={person} />
                ))}
              </IonItemGroup>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonApp>
  );
}
