// GraphQL operation documents for the Specific public API.
// Selection sets are kept intentionally conservative (common fields only).

export const MY_WORKSPACE = /* GraphQL */ `
  query MyWorkspace {
    myWorkspace {
      id
      name
      slug
    }
  }
`;

export const SURVEYS = /* GraphQL */ `
  query Surveys {
    surveys {
      id
      name
      status
      createdAt
      updatedAt
    }
  }
`;

export const SURVEY = /* GraphQL */ `
  query Survey($id: ID!) {
    survey(id: $id) {
      id
      name
      status
      createdAt
      updatedAt
    }
  }
`;

export const CONVERSATIONS = /* GraphQL */ `
  query Conversations($surveyId: ID) {
    conversations(surveyId: $surveyId) {
      id
      surveyId
      status
      createdAt
      updatedAt
    }
  }
`;

export const COMPANIES = /* GraphQL */ `
  query Companies {
    companies {
      id
      name
      domain
      createdAt
    }
  }
`;

export const USERS = /* GraphQL */ `
  query Users {
    users {
      id
      email
      name
      createdAt
    }
  }
`;

export const CREATE_OR_UPDATE_USER = /* GraphQL */ `
  mutation CreateOrUpdateUser($input: UserInput!) {
    createOrUpdateUser(input: $input) {
      id
      email
      name
      createdAt
    }
  }
`;

export const CREATE_OR_UPDATE_COMPANY = /* GraphQL */ `
  mutation CreateOrUpdateCompany($input: CompanyInput!) {
    createOrUpdateCompany(input: $input) {
      id
      name
      domain
      createdAt
    }
  }
`;

export const SUBSCRIBE_WEBHOOK = /* GraphQL */ `
  mutation SubscribeWebhook($url: String!, $event: String!) {
    subscribeWebhook(url: $url, event: $event) {
      id
      url
      event
    }
  }
`;

export const UNSUBSCRIBE_WEBHOOK = /* GraphQL */ `
  mutation UnsubscribeWebhook($id: ID!) {
    unsubscribeWebhook(id: $id)
  }
`;
