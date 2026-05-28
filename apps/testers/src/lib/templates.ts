import type { CreateScenarioInput } from "../types/index.js";

export const SCENARIO_TEMPLATES: Record<string, CreateScenarioInput[]> = {
  auth: [
    { name: "Login with valid credentials", description: "Navigate to the login page, enter valid credentials, submit the form, and verify redirect to authenticated area. Check that user menu/avatar is visible.", tags: ["auth", "smoke"], priority: "critical", requiresAuth: false, steps: ["Navigate to login page", "Enter email and password", "Submit login form", "Verify redirect to dashboard/home", "Verify user menu or avatar is visible"] },
    { name: "Signup flow", description: "Navigate to signup page, fill all required fields with valid data, submit, and verify account creation succeeds.", tags: ["auth"], priority: "high", steps: ["Navigate to signup page", "Fill all required fields", "Submit registration form", "Verify success message or redirect"] },
    { name: "Logout flow", description: "While authenticated, find and click the logout button/link, verify redirect to public page.", tags: ["auth"], priority: "medium", requiresAuth: true, steps: ["Click user menu or profile", "Click logout", "Verify redirect to login or home page"] },
  ],
  crud: [
    { name: "Create new item", description: "Navigate to the create form, fill all fields, submit, and verify the new item appears in the list.", tags: ["crud"], priority: "high", steps: ["Navigate to the list/index page", "Click create/add button", "Fill all required fields", "Submit the form", "Verify new item appears in list"] },
    { name: "Read/view item details", description: "Click on an existing item to view its details page. Verify all fields are displayed correctly.", tags: ["crud"], priority: "medium", steps: ["Navigate to list page", "Click on an item", "Verify detail page shows all fields"] },
    { name: "Update existing item", description: "Edit an existing item, change some fields, save, and verify changes persisted.", tags: ["crud"], priority: "high", steps: ["Navigate to item detail", "Click edit button", "Modify fields", "Save changes", "Verify updated values"] },
    { name: "Delete item", description: "Delete an existing item and verify it's removed from the list.", tags: ["crud"], priority: "medium", steps: ["Navigate to list page", "Click delete on an item", "Confirm deletion", "Verify item removed from list"] },
  ],
  forms: [
    { name: "Form validation - empty submission", description: "Submit a form with all fields empty and verify validation errors appear for required fields.", tags: ["forms", "validation"], priority: "high", steps: ["Navigate to form page", "Click submit without filling fields", "Verify validation errors appear for each required field"] },
    { name: "Form validation - invalid data", description: "Submit a form with invalid data (bad email, short password, etc) and verify appropriate error messages.", tags: ["forms", "validation"], priority: "high", steps: ["Navigate to form page", "Enter invalid email format", "Enter too-short password", "Submit form", "Verify specific validation error messages"] },
    { name: "Form successful submission", description: "Fill form with valid data, submit, and verify success state (redirect, success message, or data saved).", tags: ["forms"], priority: "high", steps: ["Navigate to form page", "Fill all fields with valid data", "Submit form", "Verify success state"] },
  ],
  nav: [
    { name: "Main navigation links work", description: "Click through each main navigation link and verify each page loads correctly without errors.", tags: ["navigation", "smoke"], priority: "high", steps: ["Click each nav link", "Verify page loads", "Verify no error states", "Verify breadcrumbs if present"] },
    { name: "Mobile navigation", description: "At mobile viewport, verify hamburger menu opens, navigation links are accessible, and pages load correctly.", tags: ["navigation", "responsive"], priority: "medium", steps: ["Resize to mobile viewport", "Click hamburger/menu icon", "Verify nav links appear", "Click a nav link", "Verify page loads"] },
  ],
  a11y: [
    { name: "Keyboard navigation", description: "Navigate the page using only keyboard (Tab, Enter, Escape). Verify all interactive elements are reachable and focusable.", tags: ["a11y", "keyboard"], priority: "high", steps: ["Press Tab to move through elements", "Verify focus indicators are visible", "Press Enter on buttons/links", "Verify actions trigger correctly", "Press Escape to close modals/dropdowns"] },
    { name: "Image alt text", description: "Check that all images have meaningful alt text attributes.", tags: ["a11y"], priority: "medium", steps: ["Find all images on the page", "Check each image has an alt attribute", "Verify alt text is descriptive, not empty or generic"] },
  ],
  checkout: [
    { name: "Add item to cart", description: "Navigate to a product page, add an item to cart, and verify cart count increments.", tags: ["checkout", "cart"], priority: "critical", steps: ["Navigate to product detail page", "Click add to cart button", "Verify cart count badge updates", "Verify success notification appears"] },
    { name: "Cart page shows added items", description: "Navigate to the cart page and verify previously added items are listed with correct prices and quantities.", tags: ["checkout", "cart"], priority: "high", steps: ["Navigate to cart page", "Verify all added items are listed", "Verify prices and quantities are correct", "Verify subtotal is calculated"] },
    { name: "Checkout flow completion", description: "Complete the full checkout flow: cart -> shipping -> payment -> confirmation. Verify order is placed successfully.", tags: ["checkout", "smoke"], priority: "critical", steps: ["Navigate to cart", "Click proceed to checkout", "Fill shipping address", "Select shipping method", "Fill payment details", "Review order summary", "Place order", "Verify order confirmation page"] },
    { name: "Apply coupon/discount code", description: "Enter a valid coupon code on the cart or checkout page and verify discount is applied to the total.", tags: ["checkout", "discount"], priority: "high", steps: ["Navigate to cart or checkout", "Enter coupon code", "Click apply", "Verify discount amount is shown", "Verify total is updated"] },
  ],
  search: [
    { name: "Search returns relevant results", description: "Enter a known search term and verify relevant results appear. Check that results match the query intent.", tags: ["search"], priority: "high", steps: ["Navigate to search page or focus search bar", "Enter known search term", "Submit search", "Verify results appear", "Verify result titles contain search term"] },
    { name: "Empty search handling", description: "Submit an empty search and verify the system handles it gracefully (show all results or a prompt, no errors).", tags: ["search", "validation"], priority: "medium", steps: ["Focus search bar", "Submit empty search", "Verify no crash or error state", "Verify fallback behavior (all results or prompt)"] },
    { name: "No results handling", description: "Search for a term that returns no results and verify appropriate 'no results found' messaging is displayed.", tags: ["search"], priority: "medium", steps: ["Navigate to search", "Enter nonsense term like 'xyzqwrtp'", "Submit search", "Verify no results found message", "Verify no error states"] },
    { name: "Search filters work", description: "Perform a search, apply a filter (category, date, price range), and verify results are narrowed down.", tags: ["search", "filter"], priority: "high", steps: ["Perform initial search", "Note initial result count", "Apply a filter", "Verify result count decreased", "Verify results match filter criteria"] },
  ],
};

export function getTemplate(name: string): CreateScenarioInput[] | null {
  return SCENARIO_TEMPLATES[name] ?? null;
}

export function listTemplateNames(): string[] {
  return Object.keys(SCENARIO_TEMPLATES);
}
