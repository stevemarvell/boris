import { IonItem, IonLabel, IonNote } from '@ionic/react';
import type { Person, PersonRef } from './api';

function names(people: readonly PersonRef[]): string {
  return people.map((p) => p.name).join(', ');
}

/** One relationship line, rendered only when the relationship exists. */
function Relation({ label, people }: { label: string; people: readonly PersonRef[] }) {
  if (people.length === 0) return null;
  return (
    <IonNote className="relation">
      <span className="relation-label">{label}</span> {names(people)}
    </IonNote>
  );
}

export function PersonCard({ person }: { person: Person }) {
  const relationCount =
    person.parents.length +
    person.children.length +
    person.siblings.length +
    (person.spouse ? 1 : 0);

  return (
    <IonItem data-testid="person" data-person-id={person.id} lines="full">
      <IonLabel className="ion-text-wrap">
        <h2>{person.name}</h2>
        {person.spouse && <Relation label="married to" people={[person.spouse]} />}
        <Relation label="parents" people={person.parents} />
        <Relation label="siblings" people={person.siblings} />
        <Relation label="children" people={person.children} />
        {relationCount === 0 && <IonNote className="relation">No recorded relationships</IonNote>}
      </IonLabel>
    </IonItem>
  );
}
