import {
  IonApp,
  IonContent,
  IonHeader,
  IonItemDivider,
  IonItemGroup,
  IonLabel,
  IonList,
  IonSearchbar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  setupIonicReact,
} from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { PersonCard } from './PersonCard';
import { fetchGenerations } from './api';
import type { Generation } from './api';
import { countPeople, filterGenerations } from './filter';

setupIonicReact();

type State =
  | { status: 'loading' }
  | { status: 'ready'; generations: Generation[] }
  | { status: 'failed'; reason: string };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');

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

  const shown = useMemo(
    () => (state.status === 'ready' ? filterGenerations(state.generations, query) : []),
    [state, query],
  );
  const total = state.status === 'ready' ? countPeople(state.generations) : 0;

  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Family Tree</IonTitle>
        </IonToolbar>
        {state.status === 'ready' && (
          <IonToolbar>
            <IonSearchbar
              value={query}
              debounce={150}
              placeholder="Filter by name"
              data-testid="filter"
              onIonInput={(event) => setQuery(event.detail.value ?? '')}
            />
          </IonToolbar>
        )}
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

        {/* An empty tree and a filter that matched nobody both leave the list
            empty, but they are different facts and need different words. */}
        {state.status === 'ready' && total === 0 && (
          <div className="centred" data-testid="empty-tree">
            <IonText color="medium">
              <p>No people recorded yet.</p>
            </IonText>
          </div>
        )}

        {state.status === 'ready' && total > 0 && shown.length === 0 && (
          <div className="centred" data-testid="no-matches">
            <IonText color="medium">
              <p>Nobody matches “{query}”.</p>
            </IonText>
          </div>
        )}

        {state.status === 'ready' && query.trim() !== '' && shown.length > 0 && (
          <IonText color="medium">
            <p className="match-count" data-testid="match-count">
              {countPeople(shown)} of {total} people
            </p>
          </IonText>
        )}

        {state.status === 'ready' && shown.length > 0 && (
          <IonList>
            {shown.map((generation) => (
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
